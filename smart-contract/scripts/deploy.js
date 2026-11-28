/**
 * Deploy DonationToken + CampaignFactory (beserta DonationReceipt & implementasi Campaign),
 * memberi role ke setiap aktor, lalu menyimpan alamat ke deployments/<network>.json.
 *
 * Alamat role dapat dioverride dengan env: NGO_ADDRESS, VERIFIER_ADDRESS, ORACLE_ADDRESS,
 * APPROVER_ADDRESSES (dipisah koma), APPROVAL_THRESHOLD, FIAT_CAP.
 * Default: akun development Hardhat (index 1..6).
 */
const { ethers, network } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

const DEV = {
  ngo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  verifier: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  oracle: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  approvers: ['0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9'],
};

function addr(value, name) {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`Invalid ${name}: ${value}`);
  return ethers.getAddress(value);
}

async function main() {
  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error('No deployer account');
  const ngo = addr(process.env.NGO_ADDRESS || DEV.ngo, 'NGO_ADDRESS');
  const verifier = addr(process.env.VERIFIER_ADDRESS || DEV.verifier, 'VERIFIER_ADDRESS');
  const oracle = addr(process.env.ORACLE_ADDRESS || DEV.oracle, 'ORACLE_ADDRESS');
  const approvers = (process.env.APPROVER_ADDRESSES ? process.env.APPROVER_ADDRESSES.split(',') : DEV.approvers)
    .map((a, i) => addr(a.trim(), `APPROVER_${i + 1}`));
  const threshold = Number(process.env.APPROVAL_THRESHOLD || 2);
  const fiatCap = BigInt(process.env.FIAT_CAP || 100_000_000); // Rp100 juta per transaksi

  console.log(`Deploying to ${network.name} as ${admin.address}`);
  const token = await ethers.deployContract('DonationToken', [admin.address]);
  await token.waitForDeployment();
  const factory = await ethers.deployContract('CampaignFactory',
    [await token.getAddress(), admin.address, approvers, threshold, fiatCap]);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  const send = async (p) => (await p).wait();
  // Factory perlu admin token untuk memberi MINTER_ROLE ke campaign baru, serta MINTER untuk top-up.
  await send(token.grantRole(await token.DEFAULT_ADMIN_ROLE(), factoryAddress));
  await send(token.grantRole(await token.MINTER_ROLE(), factoryAddress));
  await send(token.grantRole(await token.OFFRAMP_ROLE(), oracle));
  await send(factory.grantRole(await factory.NGO_ROLE(), ngo));
  await send(factory.grantRole(await factory.VERIFIER_ROLE(), verifier));
  await send(factory.grantRole(await factory.ORACLE_ROLE(), oracle));

  const net = await ethers.provider.getNetwork();
  const result = {
    network: network.name, chainId: Number(net.chainId), deployedAt: new Date().toISOString(),
    startBlock: (await factory.deploymentTransaction().wait()).blockNumber,
    token: await token.getAddress(), factory: factoryAddress, receipt: await factory.receipt(),
    implementation: await factory.implementation(),
    admin: admin.address, ngo, verifier, oracle, approvers, threshold, fiatCap: fiatCap.toString(),
  };
  const directory = process.env.DEPLOYMENTS_DIR || path.join(__dirname, '../deployments');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${network.name}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
