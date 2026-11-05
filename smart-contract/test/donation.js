const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Donation platform', function () {
  let admin, ngo, verifier, oracle, a1, a2, donor, recipient, outsider;
  let token, factory, campaign, receipt;
  const order = ethers.id('midtrans-order-001');

  beforeEach(async function () {
    [admin, ngo, verifier, oracle, a1, a2, donor, recipient, outsider] = await ethers.getSigners();
    token = await ethers.deployContract('DonationToken', [admin.address]);
    factory = await ethers.deployContract('CampaignFactory', [await token.getAddress(), admin.address,
      verifier.address, oracle.address, [a1.address, a2.address], 2]);
    await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), await factory.getAddress());
    await factory.grantRole(await factory.NGO_ROLE(), ngo.address);
    await factory.connect(ngo).createCampaign(recipient.address, [600, 400]);
    campaign = await ethers.getContractAt('Campaign', await factory.campaigns(0));
    receipt = await ethers.getContractAt('DonationReceipt', await factory.receipt());
  });

  async function fund(amount = 1000) {
    await campaign.connect(verifier).activate();
    await campaign.connect(oracle).recordFiatDonation(order, donor.address, amount);
  }

  it('creates, activates, records fiat, approves and releases escrow to the registered recipient', async function () {
    expect(await factory.campaignCount()).to.equal(1);
    expect(await campaign.ngo()).to.equal(ngo.address);
    await expect(campaign.connect(verifier).activate()).to.emit(campaign, 'Activated');
    await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 1000))
      .to.emit(campaign, 'DonationRecorded').withArgs(donor.address, 1000, order, 1);
    expect(await receipt.ownerOf(1)).to.equal(donor.address);
    expect(await receipt.receipts(1)).to.deep.equal([await campaign.getAddress(), 1000n, order]);
    expect(await token.balanceOf(await campaign.getAddress())).to.equal(1000);
    await expect(campaign.connect(ngo).requestWithdrawal(0, 600)).to.emit(campaign, 'WithdrawalRequested').withArgs(0, 0, 600);
    await expect(campaign.connect(a1).approveWithdrawal(0)).to.emit(campaign, 'WithdrawalApproved').withArgs(0, a1.address);
    await campaign.connect(a2).approveWithdrawal(0);
    await expect(campaign.connect(ngo).executeWithdrawal(0)).to.emit(campaign, 'WithdrawalExecuted').withArgs(0, recipient.address, 600);
    expect(await token.balanceOf(recipient.address)).to.equal(600);
    expect(await token.balanceOf(await campaign.getAddress())).to.equal(400);
    expect(await campaign.milestones(0)).to.deep.equal([600n, 600n, 0n]);
    await campaign.connect(ngo).requestWithdrawal(1, 400);
    await campaign.connect(a1).approveWithdrawal(1);
    await campaign.connect(a2).approveWithdrawal(1);
    await expect(campaign.connect(ngo).executeWithdrawal(1)).to.emit(campaign, 'Completed');
    expect(await campaign.state()).to.equal(2);
    expect(await campaign.totalPaid()).to.equal(1000);
    expect(await campaign.reserved()).to.equal(0);
  });

  it('accepts ERC20 donations using allowance and mints a receipt', async function () {
    await campaign.connect(verifier).activate();
    await token.grantRole(await token.MINTER_ROLE(), admin.address);
    await token.mint(donor.address, 200);
    await token.connect(donor).approve(await campaign.getAddress(), 200);
    await expect(campaign.connect(donor).donate(200)).to.emit(campaign, 'DonationRecorded')
      .withArgs(donor.address, 200, ethers.ZeroHash, 1);
    expect(await token.balanceOf(donor.address)).to.equal(0);
    expect(await campaign.totalDonated()).to.equal(200);
  });

  it('restricts factory, token, receipt and campaign actions to authorized roles', async function () {
    await expect(factory.connect(outsider).createCampaign(recipient.address, [100])).to.be.revertedWithCustomError(factory, 'AccessControlUnauthorizedAccount');
    await expect(token.connect(outsider).mint(donor.address, 1)).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
    await expect(receipt.connect(outsider).mint(donor.address, 1, order)).to.be.revertedWith('Only campaign');
    await expect(receipt.connect(outsider).registerCampaign(outsider.address)).to.be.revertedWith('Only factory');
    await expect(factory.connect(outsider).consumeOrder(order)).to.be.revertedWith('Only campaign');
    await expect(campaign.connect(ngo).activate()).to.be.revertedWith('Only verifier');
    await expect(campaign.connect(outsider).recordFiatDonation(order, donor.address, 100)).to.be.revertedWith('Only oracle');
    await fund();
    await expect(campaign.connect(outsider).requestWithdrawal(0, 100)).to.be.revertedWith('Only NGO');
    await campaign.connect(ngo).requestWithdrawal(0, 100);
    await expect(campaign.connect(outsider).approveWithdrawal(0)).to.be.revertedWith('Only approver');
    await expect(campaign.connect(outsider).executeWithdrawal(0)).to.be.revertedWith('Only NGO');
  });

  it('rejects duplicate fiat orders across campaigns without changing balances or receipts', async function () {
    await fund(300);
    await expect(campaign.connect(oracle).recordFiatDonation(order, donor.address, 300)).to.be.revertedWith('Duplicate order');
    await factory.connect(ngo).createCampaign(recipient.address, [1000]);
    const other = await ethers.getContractAt('Campaign', await factory.campaigns(1));
    await other.connect(verifier).activate();
    await expect(other.connect(oracle).recordFiatDonation(order, donor.address, 300)).to.be.revertedWith('Duplicate order');
    expect(await token.totalSupply()).to.equal(300);
    expect(await receipt.nextId()).to.equal(1);
  });

  it('requires distinct N-of-M approvals and prevents double execution', async function () {
    await fund();
    await campaign.connect(ngo).requestWithdrawal(0, 600);
    await expect(campaign.connect(ngo).executeWithdrawal(0)).to.be.revertedWith('Insufficient approvals');
    await campaign.connect(a1).approveWithdrawal(0);
    await expect(campaign.connect(a1).approveWithdrawal(0)).to.be.revertedWith('Already approved or executed');
    await expect(campaign.connect(ngo).executeWithdrawal(0)).to.be.revertedWith('Insufficient approvals');
    await campaign.connect(a2).approveWithdrawal(0);
    await campaign.connect(ngo).executeWithdrawal(0);
    await expect(campaign.connect(ngo).executeWithdrawal(0)).to.be.revertedWith('Already executed');
    expect(await token.balanceOf(recipient.address)).to.equal(600);
  });

  it('reserves funds and enforces milestone and escrow limits', async function () {
    await fund(500);
    await expect(campaign.connect(ngo).requestWithdrawal(0, 601)).to.be.revertedWith('Exceeds milestone');
    await expect(campaign.connect(ngo).requestWithdrawal(0, 501)).to.be.revertedWith('Insufficient escrow');
    await campaign.connect(ngo).requestWithdrawal(0, 400);
    await expect(campaign.connect(ngo).requestWithdrawal(1, 101)).to.be.revertedWith('Insufficient escrow');
    await expect(campaign.connect(ngo).requestWithdrawal(0, 201)).to.be.revertedWith('Exceeds milestone');
  });

  it('enforces lifecycle, valid amounts, targets and immutable soulbound ownership', async function () {
    await expect(campaign.connect(donor).donate(1)).to.be.revertedWith('Not active');
    await fund();
    await expect(campaign.connect(verifier).activate()).to.be.revertedWith('Invalid state');
    await expect(campaign.connect(donor).donate(0)).to.be.revertedWith('Invalid donation');
    await expect(campaign.connect(donor).donate(1)).to.be.revertedWith('Exceeds target');
    await expect(receipt.connect(donor).transferFrom(donor.address, outsider.address, 1)).to.be.revertedWith('Soulbound');
    await expect(receipt.connect(donor).approve(outsider.address, 1)).to.be.revertedWith('Soulbound');
    await expect(receipt.connect(donor).setApprovalForAll(outsider.address, true)).to.be.revertedWith('Soulbound');
  });

  it('rejects invalid recipients, budgets and approver configurations', async function () {
    await expect(factory.connect(ngo).createCampaign(ethers.ZeroAddress, [100])).to.be.revertedWith('Zero address');
    await expect(factory.connect(ngo).createCampaign(recipient.address, [])).to.be.revertedWith('No milestones');
    await expect(factory.connect(ngo).createCampaign(recipient.address, [0])).to.be.revertedWith('Zero budget');
    const args = [await token.getAddress(), admin.address, verifier.address, oracle.address];
    await expect(ethers.deployContract('CampaignFactory', [...args, [a1.address, a1.address], 2])).to.be.revertedWith('Duplicate approver');
    await expect(ethers.deployContract('CampaignFactory', [...args, [a1.address], 2])).to.be.revertedWith('Invalid threshold');
  });
});
