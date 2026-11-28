// Entrypoint container "deployer": tunggu RPC siap, deploy kontrak bila belum ada di chain, lalu seed data demo.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { JsonRpcProvider } = require('ethers');

const rpc = process.env.BESU_RPC_URL || 'http://127.0.0.1:8545';
const dir = process.env.DEPLOYMENTS_DIR || path.join(__dirname, '../deployments');
const file = path.join(dir, 'besu.json');
const run = cmd => execSync(cmd, { stdio: 'inherit', env: process.env });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  for (let i = 0; ; i++) {
    try {
      const block = await provider.getBlockNumber();
      if (block > 0) { console.log(`[deployer] RPC siap, block #${block}`); break; }
    } catch { /* belum siap */ }
    if (i > 180) throw new Error(`RPC ${rpc} tidak siap`);
    await sleep(2000);
  }
  if (fs.existsSync(file)) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ((await provider.getCode(d.factory)) !== '0x') {
      console.log(`[deployer] kontrak sudah ter-deploy di ${d.factory}`);
      if (d.seeded || process.env.SEED_DEMO === 'false') return;
      return run('npx hardhat run scripts/seed.js --network besu');
    }
    console.log('[deployer] chain baru terdeteksi, deploy ulang');
  }
  run('npx hardhat run scripts/deploy.js --network besu');
  if (process.env.SEED_DEMO !== 'false') run('npx hardhat run scripts/seed.js --network besu');
}

main().catch(e => { console.error(e); process.exit(1); });
