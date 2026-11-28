/**
 * Mengisi data demo: mendaftarkan recipient, membuat 2 campaign (1 aktif berisi donasi, 1 menunggu verifikasi).
 * Metadata campaign diunggah ke IPFS (IPFS_API_URL, default http://127.0.0.1:5001) bila tersedia.
 * Hanya untuk chain development (memakai akun mnemonic Hardhat).
 */
const { ethers, network } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

const IPFS_API = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const DAY = 24 * 60 * 60;

async function ipfsAdd(name, content, type) {
  try {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), name);
    const res = await fetch(`${IPFS_API}/api/v0/add?pin=true&cid-version=1`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).Hash;
  } catch (e) {
    console.warn(`IPFS tidak tersedia (${e.message}); metadata disimpan sebagai data URI.`);
    return null;
  }
}

function banner(title, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
<rect width="800" height="400" fill="url(#g)"/><text x="40" y="210" fill="#fff" font-family="sans-serif" font-size="40" font-weight="bold">${title}</text></svg>`;
}

async function metadata(meta, color) {
  const image = await ipfsAdd('banner.svg', banner(meta.title, color), 'image/svg+xml');
  const json = JSON.stringify({ ...meta, image: image ? `ipfs://${image}` : '' });
  const cid = await ipfsAdd('metadata.json', json, 'application/json');
  return cid || `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

async function main() {
  const file = path.join(process.env.DEPLOYMENTS_DIR || path.join(__dirname, '../deployments'), `${network.name}.json`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const signers = await ethers.getSigners();
  if (signers.length < 9) throw new Error('Seed membutuhkan akun mnemonic development (jangan set DEPLOYER_PRIVATE_KEY)');
  const [, ngo, verifier, oracle, , , , , recipient] = signers;
  const factory = await ethers.getContractAt('CampaignFactory', d.factory);
  const wait = async (p) => (await p).wait();
  const now = (await ethers.provider.getBlock('latest')).timestamp;

  await wait(factory.connect(verifier).registerRecipient(recipient.address, true));

  const campaigns = [
    { color: '#0f766e', budgets: [5_000_000, 3_000_000, 2_000_000], meta: {
      title: 'Air Bersih untuk Desa Sumber Rejo',
      description: 'Pembangunan sumur bor dan instalasi pipa air bersih untuk 120 keluarga di Desa Sumber Rejo yang setiap musim kemarau kesulitan air.',
      category: 'Infrastruktur', organizer: 'Yayasan Tirta Nusantara',
      milestones: [
        { title: 'Pengeboran sumur', plan: 'Sewa alat bor, upah pekerja, dan uji kualitas air' },
        { title: 'Pipa & tandon', plan: 'Pembelian pipa 800 m dan 4 tandon air 5.000 L' },
        { title: 'Pemasangan kran umum', plan: 'Pemasangan 10 titik kran umum dan pelatihan perawatan' },
      ] } },
    { color: '#b45309', budgets: [4_000_000, 4_000_000], meta: {
      title: 'Beasiswa Anak Nelayan Pesisir',
      description: 'Biaya sekolah satu semester dan perlengkapan belajar untuk 40 anak nelayan di pesisir utara Jawa.',
      category: 'Pendidikan', organizer: 'Komunitas Pesisir Cerdas',
      milestones: [
        { title: 'SPP semester ganjil', plan: 'Pembayaran SPP langsung ke rekening sekolah' },
        { title: 'Perlengkapan sekolah', plan: 'Seragam, buku, dan tas untuk 40 anak' },
      ] } },
  ];

  const created = [];
  for (const c of campaigns) {
    const cid = await metadata(c.meta, c.color);
    const rc = await wait(factory.connect(ngo).createCampaign(recipient.address, now + 60 * DAY, cid, c.budgets));
    const ev = rc.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find(e => e?.name === 'CampaignCreated');
    created.push(ev.args.campaign);
    console.log(`Campaign "${c.meta.title}" -> ${ev.args.campaign} (metadata ${cid.slice(0, 40)}...)`);
  }

  const first = await ethers.getContractAt('Campaign', created[0]);
  await wait(first.connect(verifier).activate());
  await wait(first.connect(oracle).recordFiatDonation(ethers.id('SEED-DON-001'), signers[7].address, 1_500_000));
  await wait(first.connect(oracle).recordFiatDonation(ethers.id('SEED-DON-002'), signers[0].address, 750_000));
  fs.writeFileSync(file, JSON.stringify({ ...d, seeded: true, demoCampaigns: created }, null, 2));
  console.log('Seed selesai: campaign #1 aktif dengan 2 donasi, campaign #2 menunggu verifikasi.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
