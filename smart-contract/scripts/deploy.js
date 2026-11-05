const { ethers, network } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) throw new Error('Set DEPLOYER_PRIVATE_KEY for Besu');
  const admin = signers[0];
  const roleAddress = async (name, index) => {
    const value = process.env[name] || (network.name !== 'besu' && signers[index]?.address);
    if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`Set ${name}`);
    return value;
  };
  const ngo = await roleAddress('NGO_ADDRESS', 1);
  const verifier = await roleAddress('VERIFIER_ADDRESS', 2);
  const oracle = await roleAddress('ORACLE_ADDRESS', 3);
  const approvers = [await roleAddress('APPROVER_1_ADDRESS', 4), await roleAddress('APPROVER_2_ADDRESS', 5)];
  const token = await ethers.deployContract('DonationToken', [admin.address]);
  await token.waitForDeployment();
  const factory = await ethers.deployContract('CampaignFactory', [await token.getAddress(), admin.address, verifier, oracle, approvers, 2]);
  await factory.waitForDeployment();
  await (await token.grantRole(await token.DEFAULT_ADMIN_ROLE(), await factory.getAddress())).wait();
  await (await factory.grantRole(await factory.NGO_ROLE(), ngo)).wait();
  const result = { network: network.name, chainId: String((await ethers.provider.getNetwork()).chainId),
    token: await token.getAddress(), factory: await factory.getAddress(), receipt: await factory.receipt(),
    admin: admin.address, ngo, verifier, oracle, approvers, threshold: 2 };
  const directory = path.join(__dirname, '../deployments');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${network.name}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
