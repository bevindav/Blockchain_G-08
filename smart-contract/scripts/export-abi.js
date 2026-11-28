// Menyalin ABI hasil kompilasi ke frontend dan oracle agar keduanya selalu sinkron dengan kontrak.
const fs = require('node:fs');
const path = require('node:path');
const names = ['DonationToken', 'CampaignFactory', 'Campaign', 'DonationReceipt'];
const targets = ['../../frontend/src/lib/abi', '../../oracle/src/abi'].map(p => path.join(__dirname, p));
for (const dir of targets) fs.mkdirSync(dir, { recursive: true });
for (const name of names) {
  const { abi } = JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`), 'utf8'));
  for (const dir of targets) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(abi, null, 2));
}
console.log(`ABI exported to ${targets.join(', ')}`);
