const { expect } = require('chai');
const { ethers, network } = require('hardhat');

const DAY = 24 * 60 * 60;
const proof = label => ethers.id(`proof:${label}`);
const cid = label => `bafy-${label}`;

describe('Donation platform', function () {
  let admin, ngo, verifier, oracle, a1, a2, a3, donor, recipient, outsider, donor2;
  let token, factory, receipt, campaign, deadline;
  const order = ethers.id('DON-001');

  async function now() { return (await ethers.provider.getBlock('latest')).timestamp; }

  async function newCampaign(budgets = [600, 400], opts = {}) {
    const dl = opts.deadline ?? (await now()) + 30 * DAY;
    const tx = await factory.connect(ngo).createCampaign(opts.recipient ?? recipient.address, dl, 'bafy-meta', budgets);
    await tx.wait();
    const addr = await factory.campaigns((await factory.campaignCount()) - 1n);
    return ethers.getContractAt('Campaign', addr);
  }

  beforeEach(async function () {
    [admin, ngo, verifier, oracle, a1, a2, a3, donor, recipient, outsider, donor2] = await ethers.getSigners();
    token = await ethers.deployContract('DonationToken', [admin.address]);
    factory = await ethers.deployContract('CampaignFactory', [await token.getAddress(), admin.address,
      [a1.address, a2.address, a3.address], 2, 10_000_000]);
    const f = await factory.getAddress();
    await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), f);
    await token.grantRole(await token.MINTER_ROLE(), f);
    await token.grantRole(await token.OFFRAMP_ROLE(), oracle.address);
    await factory.grantRole(await factory.NGO_ROLE(), ngo.address);
    await factory.grantRole(await factory.VERIFIER_ROLE(), verifier.address);
    await factory.grantRole(await factory.ORACLE_ROLE(), oracle.address);
    await factory.connect(verifier).registerRecipient(recipient.address, true);
    receipt = await ethers.getContractAt('DonationReceipt', await factory.receipt());
    campaign = await newCampaign();
    deadline = await campaign.deadline();
  });

  async function fund(amount = 1000, c = campaign, id = order) {
    if ((await c.state()) === 0n) await c.connect(verifier).activate();
    await c.connect(oracle).recordFiatDonation(id, donor.address, amount);
  }

  async function approvedWithdrawal(milestone, amount, label, c = campaign) {
    await c.connect(ngo).requestWithdrawal(milestone, amount, proof(label), cid(label));
    const id = (await c.summary()).withdrawalCount - 1n;
    await c.connect(a1).approveWithdrawal(id);
    await c.connect(a2).approveWithdrawal(id);
    return id;
  }

  describe('happy path', function () {
    it('runs the full lifecycle: create -> activate -> fiat donation -> N-of-M -> execute -> report -> complete', async function () {
      const s0 = await campaign.summary();
      expect(s0.ngo).to.equal(ngo.address);
      expect(s0.totalBudget).to.equal(1000);
      expect(s0.threshold).to.equal(2);
      expect(s0.approverCount).to.equal(3);
      expect(s0.metadataCID).to.equal('bafy-meta');

      await expect(campaign.connect(verifier).activate()).to.emit(campaign, 'Activated').withArgs(verifier.address);
      await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 1000))
        .to.emit(campaign, 'DonationRecorded').withArgs(donor.address, 1000, order, 1);
      expect(await receipt.ownerOf(1)).to.equal(donor.address);
      expect(await receipt.receiptOfOrder(order)).to.equal(1);
      expect(await token.balanceOf(await campaign.getAddress())).to.equal(1000);

      await expect(campaign.connect(ngo).requestWithdrawal(0, 600, proof('inv-1'), cid('inv-1')))
        .to.emit(campaign, 'WithdrawalRequested').withArgs(0, 0, 600, proof('inv-1'), cid('inv-1'));
      await expect(campaign.connect(a1).approveWithdrawal(0)).to.emit(campaign, 'WithdrawalApproved').withArgs(0, a1.address);
      await expect(campaign.connect(a2).approveWithdrawal(0)).to.emit(campaign, 'WithdrawalClosed').withArgs(0, 1);
      await expect(campaign.connect(ngo).executeWithdrawal(0))
        .to.emit(campaign, 'WithdrawalExecuted').withArgs(0, recipient.address, 600);
      expect(await token.balanceOf(recipient.address)).to.equal(600);
      expect(await campaign.milestones(0)).to.deep.equal([600n, 600n, 0n]);

      await expect(campaign.connect(recipient).submitReport(0, proof('photo-1'), cid('photo-1')))
        .to.emit(campaign, 'ReportSubmitted').withArgs(0, recipient.address, proof('photo-1'), cid('photo-1'));

      const id = await approvedWithdrawal(1, 400, 'inv-2');
      await expect(campaign.connect(a3).executeWithdrawal(id)).to.emit(campaign, 'Completed');
      const s = await campaign.summary();
      expect(s.state).to.equal(2);
      expect(s.totalPaid).to.equal(1000);
      expect(s.reserved).to.equal(0);
      expect(s.balance).to.equal(0);
    });

    it('accepts dIDR donations through allowance after a fiat top-up', async function () {
      await campaign.connect(verifier).activate();
      const topup = ethers.id('TOP-001');
      await expect(factory.connect(oracle).topUp(topup, donor.address, 200))
        .to.emit(factory, 'TopUpRecorded').withArgs(topup, donor.address, 200);
      await expect(factory.connect(oracle).topUp(topup, donor.address, 200)).to.be.revertedWithCustomError(factory, 'DuplicateOrder');
      await token.connect(donor).approve(await campaign.getAddress(), 200);
      await expect(campaign.connect(donor).donate(200)).to.emit(campaign, 'DonationRecorded')
        .withArgs(donor.address, 200, ethers.ZeroHash, 1);
      expect(await token.balanceOf(donor.address)).to.equal(0);
      expect(await campaign.contributions(donor.address)).to.equal(200);
    });

    it('issues an on-chain soulbound receipt with ERC-5192 support', async function () {
      await fund(250);
      const uri = await receipt.tokenURI(1);
      const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
      expect(json.name).to.equal('Kuitansi Donasi #1');
      expect(json.attributes.find(a => a.trait_type === 'Amount (IDR)').value).to.equal(250);
      expect(json.image).to.match(/^data:image\/svg\+xml;base64,/);
      expect(await receipt.locked(1)).to.equal(true);
      expect(await receipt.supportsInterface('0xb45a3c0e')).to.equal(true);
      await expect(receipt.connect(donor).transferFrom(donor.address, outsider.address, 1)).to.be.revertedWithCustomError(receipt, 'Soulbound');
      await expect(receipt.connect(donor).approve(outsider.address, 1)).to.be.revertedWithCustomError(receipt, 'Soulbound');
      await expect(receipt.connect(donor).setApprovalForAll(outsider.address, true)).to.be.revertedWithCustomError(receipt, 'Soulbound');
    });
  });

  describe('access control (OWASP SC01)', function () {
    it('restricts every privileged action to its role', async function () {
      await expect(factory.connect(outsider).createCampaign(recipient.address, deadline, 'x', [100]))
        .to.be.revertedWithCustomError(factory, 'AccessControlUnauthorizedAccount');
      await expect(factory.connect(outsider).registerRecipient(outsider.address, true))
        .to.be.revertedWithCustomError(factory, 'AccessControlUnauthorizedAccount');
      await expect(factory.connect(outsider).topUp(order, donor.address, 1))
        .to.be.revertedWithCustomError(factory, 'AccessControlUnauthorizedAccount');
      await expect(factory.connect(outsider).setFiatCap(1)).to.be.revertedWithCustomError(factory, 'AccessControlUnauthorizedAccount');
      await expect(factory.connect(outsider).consumeOrder(order)).to.be.revertedWithCustomError(factory, 'OnlyCampaign');
      await expect(factory.connect(outsider).consumeProof(order)).to.be.revertedWithCustomError(factory, 'OnlyCampaign');
      await expect(token.connect(outsider).mint(donor.address, 1)).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
      await expect(token.connect(outsider).pause()).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
      await expect(receipt.connect(outsider).mint(donor.address, 1, order)).to.be.revertedWithCustomError(receipt, 'OnlyCampaign');
      await expect(receipt.connect(outsider).registerCampaign(outsider.address)).to.be.revertedWithCustomError(receipt, 'OnlyFactory');
      await expect(campaign.connect(ngo).activate()).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).cancel('x')).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).recordFiatDonation(order, donor.address, 100)).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await fund();
      await expect(campaign.connect(outsider).requestWithdrawal(0, 100, proof('a'), cid('a'))).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await campaign.connect(ngo).requestWithdrawal(0, 100, proof('a'), cid('a'));
      await expect(campaign.connect(outsider).approveWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(ngo).approveWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).rejectWithdrawal(0, 'x')).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).cancelWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).executeWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(outsider).submitReport(0, proof('r'), cid('r'))).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(token.connect(outsider).confirmRedemption(0, order)).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
    });

    it('cannot re-initialize a campaign clone or the implementation', async function () {
      await expect(campaign.initialize(ngo.address, recipient.address, deadline, 'x', [1], [a1.address], 1))
        .to.be.revertedWithCustomError(campaign, 'AlreadyInitialized');
      const impl = await ethers.getContractAt('Campaign', await factory.implementation());
      await expect(impl.initialize(ngo.address, recipient.address, deadline, 'x', [1], [a1.address], 1))
        .to.be.revertedWithCustomError(impl, 'AlreadyInitialized');
    });
  });

  describe('FR-08 business rule enforcement', function () {
    it('rejects unregistered recipients and invalid campaign configs', async function () {
      await expect(newCampaign([100], { recipient: outsider.address })).to.be.revertedWithCustomError(factory, 'RecipientNotRegistered');
      await expect(newCampaign([])).to.be.revertedWithCustomError(campaign, 'NoMilestones');
      await expect(newCampaign([100, 0])).to.be.revertedWithCustomError(campaign, 'ZeroBudget');
      await expect(newCampaign([100], { deadline: await now() })).to.be.revertedWithCustomError(campaign, 'InvalidDeadline');
      await factory.connect(verifier).registerRecipient(recipient.address, false);
      await expect(newCampaign([100])).to.be.revertedWithCustomError(factory, 'RecipientNotRegistered');
    });

    it('rejects fiat orders recorded twice, even across campaigns', async function () {
      await fund(300);
      await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 300)).to.be.revertedWithCustomError(factory, 'DuplicateOrder');
      const other = await newCampaign([1000]);
      await other.connect(verifier).activate();
      await expect(other.connect(oracle).recordFiatDonation(order, donor.address, 300)).to.be.revertedWithCustomError(factory, 'DuplicateOrder');
      await expect(factory.connect(oracle).topUp(order, donor.address, 300)).to.be.revertedWithCustomError(factory, 'DuplicateOrder');
      await expect(campaign.connect(oracle).recordFiatDonation(ethers.ZeroHash, donor.address, 1)).to.be.revertedWithCustomError(factory, 'DuplicateOrder');
      expect(await campaign.totalDonated()).to.equal(300);
      expect(await receipt.nextId()).to.equal(1);
    });

    it('rejects duplicate proofs across withdrawals, reports and campaigns', async function () {
      await fund();
      await campaign.connect(ngo).requestWithdrawal(0, 100, proof('dup'), cid('dup'));
      await expect(campaign.connect(ngo).requestWithdrawal(0, 100, proof('dup'), cid('dup2'))).to.be.revertedWithCustomError(factory, 'DuplicateProof');
      await expect(campaign.connect(ngo).requestWithdrawal(0, 100, ethers.ZeroHash, cid('x'))).to.be.revertedWithCustomError(campaign, 'InvalidProof');
      await expect(campaign.connect(ngo).requestWithdrawal(0, 100, proof('y'), '')).to.be.revertedWithCustomError(campaign, 'InvalidProof');
      const id = await approvedWithdrawal(0, 100, 'b');
      await campaign.connect(ngo).executeWithdrawal(id);
      await expect(campaign.connect(ngo).submitReport(id, proof('dup'), cid('dup'))).to.be.revertedWithCustomError(factory, 'DuplicateProof');
      await expect(campaign.connect(ngo).submitReport(0, proof('z'), cid('z'))).to.be.revertedWithCustomError(campaign, 'InvalidWithdrawal');
    });

    it('enforces milestone budgets, escrow balance and donation target', async function () {
      await fund(500);
      await expect(campaign.connect(ngo).requestWithdrawal(0, 601, proof('a'), cid('a'))).to.be.revertedWithCustomError(campaign, 'ExceedsMilestone');
      await expect(campaign.connect(ngo).requestWithdrawal(2, 1, proof('a'), cid('a'))).to.be.revertedWithCustomError(campaign, 'InvalidWithdrawal');
      await expect(campaign.connect(ngo).requestWithdrawal(0, 0, proof('a'), cid('a'))).to.be.revertedWithCustomError(campaign, 'InvalidWithdrawal');
      await campaign.connect(ngo).requestWithdrawal(0, 400, proof('a'), cid('a'));
      await expect(campaign.connect(ngo).requestWithdrawal(1, 101, proof('b'), cid('b'))).to.be.revertedWithCustomError(campaign, 'InsufficientEscrow');
      await expect(campaign.connect(ngo).requestWithdrawal(0, 201, proof('b'), cid('b'))).to.be.revertedWithCustomError(campaign, 'ExceedsMilestone');
      await expect(campaign.connect(oracle).recordFiatDonation(ethers.id('o2'), donor.address, 501)).to.be.revertedWithCustomError(campaign, 'ExceedsTarget');
      await expect(campaign.connect(oracle).recordFiatDonation(ethers.id('o3'), donor.address, 0)).to.be.revertedWithCustomError(campaign, 'InvalidDonation');
      await expect(campaign.connect(oracle).recordFiatDonation(ethers.id('o4'), ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(campaign, 'InvalidDonation');
    });

    it('requires distinct approvals, prevents double voting and double execution', async function () {
      await fund();
      await campaign.connect(ngo).requestWithdrawal(0, 600, proof('a'), cid('a'));
      await campaign.connect(a1).approveWithdrawal(0);
      await expect(campaign.connect(a1).approveWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'AlreadyVoted');
      await expect(campaign.connect(ngo).executeWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await campaign.connect(a2).approveWithdrawal(0);
      await expect(campaign.connect(a3).approveWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await campaign.connect(ngo).executeWithdrawal(0);
      await expect(campaign.connect(ngo).executeWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await expect(campaign.connect(ngo).executeWithdrawal(9)).to.be.revertedWithCustomError(campaign, 'InvalidWithdrawal');
      expect(await token.balanceOf(recipient.address)).to.equal(600);
    });

    it('auto-rejects when quorum becomes impossible and releases the reservation', async function () {
      await fund();
      await campaign.connect(ngo).requestWithdrawal(0, 600, proof('a'), cid('a'));
      expect(await campaign.reserved()).to.equal(600);
      await expect(campaign.connect(a1).rejectWithdrawal(0, 'invoice blur')).to.emit(campaign, 'WithdrawalRejected');
      expect((await campaign.withdrawals(0)).status).to.equal(0); // masih pending (1 dari 3 menolak, kuorum 2 masih mungkin)
      await expect(campaign.connect(a2).rejectWithdrawal(0, 'fake')).to.emit(campaign, 'WithdrawalClosed').withArgs(0, 3);
      expect(await campaign.reserved()).to.equal(0);
      expect((await campaign.milestones(0)).reserved).to.equal(0);
      await expect(campaign.connect(a3).approveWithdrawal(0)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      // dana dapat diajukan ulang dengan bukti baru
      await campaign.connect(ngo).requestWithdrawal(0, 600, proof('b'), cid('b'));
    });

    it('lets the NGO cancel an unexecuted withdrawal', async function () {
      await fund();
      const id = await approvedWithdrawal(0, 300, 'a');
      await expect(campaign.connect(ngo).cancelWithdrawal(id)).to.emit(campaign, 'WithdrawalClosed').withArgs(id, 4);
      expect(await campaign.reserved()).to.equal(0);
      await expect(campaign.connect(ngo).executeWithdrawal(id)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await expect(campaign.connect(ngo).cancelWithdrawal(id)).to.be.revertedWithCustomError(campaign, 'InvalidState');
    });
  });

  describe('lifecycle, deadline and refunds', function () {
    it('enforces campaign state transitions and deadline', async function () {
      await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 1)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await campaign.connect(verifier).activate();
      await expect(campaign.connect(verifier).activate()).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await network.provider.send('evm_increaseTime', [31 * DAY]);
      await network.provider.send('evm_mine');
      await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 1)).to.be.revertedWithCustomError(campaign, 'DeadlinePassed');
      const late = await newCampaign([10]);
      await network.provider.send('evm_increaseTime', [31 * DAY]);
      await network.provider.send('evm_mine');
      await expect(late.connect(verifier).activate()).to.be.revertedWithCustomError(late, 'DeadlinePassed');
    });

    it('refunds donors proportionally to the remaining escrow after cancellation (FR-10)', async function () {
      await campaign.connect(verifier).activate();
      await campaign.connect(oracle).recordFiatDonation(ethers.id('a'), donor.address, 600);
      await campaign.connect(oracle).recordFiatDonation(ethers.id('b'), donor2.address, 200);
      const id = await approvedWithdrawal(0, 400, 'w');
      await campaign.connect(ngo).executeWithdrawal(id);
      await campaign.connect(ngo).requestWithdrawal(1, 100, proof('pending'), cid('pending'));
      // 800 donasi - 400 sudah dicairkan = 400 escrow; pending withdrawal dilepas saat cancel
      await expect(campaign.connect(verifier).cancel('NGO terindikasi fraud'))
        .to.emit(campaign, 'Cancelled').withArgs(verifier.address, 'NGO terindikasi fraud', 400);
      expect(await campaign.refundableOf(donor.address)).to.equal(300);
      await expect(campaign.connect(outsider).claimRefund(donor.address)).to.emit(campaign, 'Refunded').withArgs(donor.address, 300);
      await campaign.connect(donor2).claimRefund(donor2.address);
      expect(await token.balanceOf(donor.address)).to.equal(300);
      expect(await token.balanceOf(donor2.address)).to.equal(100);
      await expect(campaign.claimRefund(donor.address)).to.be.revertedWithCustomError(campaign, 'NothingToRefund');
      await expect(campaign.claimRefund(outsider.address)).to.be.revertedWithCustomError(campaign, 'NothingToRefund');
      await expect(campaign.connect(ngo).executeWithdrawal(1)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      await expect(campaign.connect(ngo).cancel('again')).to.be.revertedWithCustomError(campaign, 'InvalidState');
    });

    it('blocks refunds while the campaign is not cancelled', async function () {
      await fund(100);
      await expect(campaign.claimRefund(donor.address)).to.be.revertedWithCustomError(campaign, 'InvalidState');
      expect(await campaign.refundableOf(donor.address)).to.equal(0);
    });
  });

  describe('oracle manipulation mitigations', function () {
    it('caps every fiat transaction and lets admin tune the cap', async function () {
      await campaign.connect(verifier).activate();
      await factory.setFiatCap(500);
      await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 501)).to.be.revertedWithCustomError(campaign, 'ExceedsFiatCap');
      await expect(factory.connect(oracle).topUp(order, donor.address, 501)).to.be.revertedWithCustomError(factory, 'ExceedsFiatCap');
      await campaign.connect(oracle).recordFiatDonation(order, donor.address, 500);
    });

    it('oracle key cannot move escrow funds', async function () {
      await fund();
      await expect(campaign.connect(oracle).requestWithdrawal(0, 1, proof('a'), cid('a'))).to.be.revertedWithCustomError(campaign, 'Unauthorized');
      await expect(campaign.connect(oracle).cancel('x')).to.be.revertedWithCustomError(campaign, 'Unauthorized');
    });
  });

  describe('dIDR token: off-ramp and circuit breaker', function () {
    it('burns on redeem and lets the off-ramp oracle confirm once', async function () {
      await fund();
      const id = await approvedWithdrawal(0, 600, 'a');
      await campaign.connect(ngo).executeWithdrawal(id);
      const bankRef = ethers.id('bank:BCA:123');
      await expect(token.connect(recipient).redeem(600, bankRef))
        .to.emit(token, 'RedemptionRequested').withArgs(0, recipient.address, 600, bankRef);
      expect(await token.balanceOf(recipient.address)).to.equal(0);
      await expect(token.connect(oracle).confirmRedemption(0, ethers.id('payout-1')))
        .to.emit(token, 'RedemptionPaid').withArgs(0, recipient.address, 600, ethers.id('payout-1'));
      await expect(token.connect(oracle).confirmRedemption(0, ethers.id('payout-2'))).to.be.revertedWithCustomError(token, 'InvalidRedemption');
      await expect(token.connect(recipient).redeem(1, bankRef)).to.be.revertedWithCustomError(token, 'ERC20InsufficientBalance');
      await expect(token.connect(recipient).redeem(0, bankRef)).to.be.revertedWithCustomError(token, 'ZeroAmount');
    });

    it('pausing the token halts donations and withdrawals', async function () {
      await fund(500);
      const id = await approvedWithdrawal(0, 100, 'a');
      await token.pause();
      await expect(campaign.connect(oracle).recordFiatDonation(ethers.id('x'), donor.address, 1)).to.be.revertedWithCustomError(token, 'EnforcedPause');
      await expect(campaign.connect(ngo).executeWithdrawal(id)).to.be.revertedWithCustomError(token, 'EnforcedPause');
      await token.unpause();
      await campaign.connect(ngo).executeWithdrawal(id);
    });
  });

  describe('factory configuration', function () {
    it('validates approver sets and snapshots them per campaign', async function () {
      await expect(factory.setApprovers([a1.address], 2)).to.be.revertedWithCustomError(factory, 'InvalidThreshold');
      await expect(factory.setApprovers([a1.address, a1.address], 1)).to.be.revertedWithCustomError(factory, 'InvalidApprover');
      await expect(factory.setApprovers([ethers.ZeroAddress], 1)).to.be.revertedWithCustomError(factory, 'InvalidApprover');
      await expect(factory.setApprovers([a1.address], 0)).to.be.revertedWithCustomError(factory, 'InvalidThreshold');
      await factory.setApprovers([outsider.address], 1);
      const fresh = await newCampaign([10]);
      expect(await fresh.getApprovers()).to.deep.equal([outsider.address]);
      expect(await campaign.getApprovers()).to.deep.equal([a1.address, a2.address, a3.address]);
      expect(await campaign.isApprover(outsider.address)).to.equal(false);
    });

    it('lists campaigns', async function () {
      await newCampaign([10]);
      expect(await factory.getCampaigns()).to.have.length(2);
      expect(await factory.isCampaign(await campaign.getAddress())).to.equal(true);
    });
  });
});
