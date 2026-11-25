# DonasiTransparan — Platform Donasi dengan Transparansi Dana melalui Smart Contract

Tugas Besar IF4035 Blockchain — Kelompok G-08

| Nama | NIM |
| --- | --- |
| Indah Novita | 13523047 |
| Andrew Isra Saputra DB | 13523110 |
| Bevinda Vivian | 13523120 |

## Deskripsi aplikasi

DonasiTransparan adalah dApp donasi yang membuat setiap rupiah dapat ditelusuri **end-to-end**: donasi → escrow → pengajuan pencairan per milestone (dengan bukti) → persetujuan multi-pihak → pengiriman ke wallet penerima terdaftar → laporan penyaluran → penukaran ke rekening bank penerima. Seluruh jejak tercatat di private blockchain yang dijalankan bersama oleh beberapa validator (platform, NGO, auditor), sehingga tidak ada satu pihak pun yang dapat mengubah data secara sepihak.

Fitur utama:

- **Donasi rupiah tanpa wallet** (QRIS/VA via Midtrans Sandbox) yang dicatat on-chain oleh **payment oracle**. Oracle memverifikasi signature SHA512, mengecek ulang ke Status API, mencocokkan nominal, dan mencegah pencatatan ganda.
- **Donasi dIDR via MetaMask** (token ERC-20, 1 dIDR = Rp1). dIDR diperoleh lewat top-up rupiah (on-ramp).
- **Escrow per campaign** dengan **milestone**, **persetujuan N-of-M** (default 2 dari 3 approver), auto-reject bila kuorum mustahil tercapai, dan pembatalan pengajuan.
- **Bukti penggunaan dana di IPFS**. Hash keccak256 file dicatat on-chain, bukti duplikat ditolak di semua campaign, dan siapa pun dapat memverifikasi hash dari UI.
- **Kuitansi NFT soulbound** (ERC-721 + ERC-5192). Metadata dan gambarnya dibangkitkan sepenuhnya on-chain dan dapat diverifikasi dengan nomor kuitansi atau Order ID.
- **Registri wallet penerima** oleh verifikator. Pencairan hanya bisa dikirim ke recipient terdaftar.
- **Refund proporsional** bila campaign dibatalkan.
- **Off-ramp**: penerima menukar dIDR ke rekening bank. Token dibakar, oracle mentransfer dana (simulasi), lalu mengonfirmasi on-chain. Data rekening tidak pernah ditulis on-chain.
- **Circuit breaker** (pause token), batas nominal fiat per transaksi, dan fallback RPC antar validator.
- Frontend menampilkan **status transaksi** (menunggu tanda tangan → pending → sukses/gagal beserta alasan), **timeline dana** dari event log, dashboard per role, dan **explorer** blok/transaksi/event.

Dokumentasi lain:

- [docs/user-guide.md](docs/user-guide.md) — instalasi, deployment, dan use case setiap role
- [docs/api.md](docs/api.md) — endpoint oracle/backend dan struktur JSON
- [docs/architecture.md](docs/architecture.md) — arsitektur, alur, dan desain smart contract
- [docs/security.md](docs/security.md) — pemetaan OWASP Smart Contract Top 10, mitigasi oracle manipulation, Slither, dan optimasi gas

## Struktur repository

```text
frontend/        Next.js 16 + TypeScript + Tailwind CSS + ethers v6 (MetaMask)
smart-contract/  Solidity 0.8.24 + Hardhat + OpenZeppelin 5
  contracts/     DonationToken, CampaignFactory, Campaign, DonationReceipt
  test/          21 unit test (100% line coverage)
  scripts/       deploy.js, seed.js, docker-deploy.js, export-abi.js
  network/       genesis QBFT + skrip node Besu
oracle/          Node.js + TypeScript (Express, PostgreSQL, BullMQ/Redis, Midtrans, IPFS)
docs/            dokumentasi, laporan gas, laporan Slither, diagram arsitektur
docker-compose.yml  deployment otomatis seluruh sistem
```

## System requirement

| Komponen | Kebutuhan |
| --- | --- |
| OS | Linux, macOS, atau Windows 10/11 (Docker Desktop + WSL2) |
| Docker | Docker Engine 24+ / Docker Desktop dengan Docker Compose v2 |
| RAM | minimal 6 GB bebas (4 node Besu ±0,5 GB/node, ditambah Postgres, Redis, IPFS, oracle, dan frontend) |
| Disk | ±4 GB untuk image |
| Browser | Chrome/Firefox/Brave dengan ekstensi **MetaMask** |
| Untuk pengembangan tanpa Docker | Node.js 22 LTS dan npm 10 |
| Opsional | Akun Midtrans Sandbox (pembayaran nyata sandbox) dan ngrok (webhook) |

Port lokal yang dipakai: `8545`/`8546` (RPC validator 1/2), `8080` (gateway IPFS), `4000` (oracle API), dan `3000` (frontend).

## Cara cepat (semua otomatis)

```bash
git clone https://github.com/bevindav/Blockchain_G-08.git
cd Blockchain_G-08
cp .env.example .env          # opsional: isi key Midtrans Sandbox
docker compose up -d --build  # ±3-5 menit pada build pertama
```

Buka **http://localhost:3000**. Perintah di atas menjalankan berurutan: pembuatan genesis dan key validator, 4 validator Besu, deploy kontrak, seed data demo, IPFS, PostgreSQL, Redis, oracle, dan frontend.

```bash
docker compose ps                     # status seluruh layanan
docker compose logs -f oracle         # log oracle (verifikasi pembayaran, tx on-chain)
docker compose down                   # berhenti (data tetap tersimpan)
docker compose down -v                # reset total: chain, database, IPFS
```

## Langkah menjalankan private chain

Private chain memakai **Hyperledger Besu 24.12** dengan konsensus **QBFT** (Proof-of-Authority BFT), 4 validator, chainId **1337**, block time 2 detik, dan gas price 0. Dengan 4 validator, jaringan tetap berjalan walaupun satu validator mati (toleransi f = 1).

```bash
docker compose up -d validator1 validator2 validator3 validator4
```

1. Service `besu-init` menjalankan `besu operator generate-blockchain-config` dengan [`smart-contract/network/qbft-config.json`](smart-contract/network/qbft-config.json) untuk membuat genesis dan 4 key validator ke volume `besu-config`. Langkah ini hanya berjalan sekali.
2. Setiap validator dijalankan oleh [`smart-contract/network/scripts/start-node.sh`](smart-contract/network/scripts/start-node.sh) dan terhubung ke validator1 sebagai bootnode.
3. RPC JSON tersedia di `http://127.0.0.1:8545` (validator1) dan `http://127.0.0.1:8546` (validator2, fallback).

Verifikasi jaringan:

```bash
curl -s -X POST localhost:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
curl -s -X POST localhost:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Genesis mendanai 10 akun development Hardhat (mnemonic publik `test test ... junk`) **hanya untuk chain lokal**. Daftar akun dan role tersedia di [docs/user-guide.md](docs/user-guide.md#akun-demo).

## Deployment smart contract pada private chain

Dengan Docker (otomatis): service `deployer` menunggu RPC siap, lalu men-deploy kontrak bila belum ada di chain dan menjalankan seed demo. Alamat kontrak disimpan di volume `deployments` dan disajikan oleh `GET http://localhost:4000/api/config`.

Manual dari host:

```bash
cd smart-contract
npm ci
npm run compile
npm test                 # 21 unit test
npm run test:gas         # laporan gas (hardhat-gas-reporter)
npm run coverage         # solidity-coverage
npm run deploy:besu      # deploy ke Besu (http://127.0.0.1:8545) -> deployments/besu.json
npm run seed:besu        # opsional: data demo
```

Untuk mengganti alamat role, set environment `DEPLOYER_PRIVATE_KEY`, `NGO_ADDRESS`, `VERIFIER_ADDRESS`, `ORACLE_ADDRESS`, `APPROVER_ADDRESSES` (dipisah koma), `APPROVAL_THRESHOLD`, dan `FIAT_CAP` sebelum `npm run deploy:besu`. Tanpa Besu, kontrak juga bisa dicoba di Hardhat node: `npm run node`, lalu `npm run deploy:local` dan `npm run seed:local` di terminal lain.

Setelah mengubah kontrak, jalankan `npm run export-abi` untuk menyalin ABI ke `frontend/src/lib/abi` dan `oracle/src/abi`.

## Deployment dan integrasi oracle

Oracle (`oracle/`) adalah layanan Node.js + TypeScript dengan komponen berikut:

- **Payment oracle**: `POST /api/payments/webhook` menerima notifikasi Midtrans → verifikasi signature → cek ulang Status API → cocokkan nominal → antrean BullMQ → `recordFiatDonation()` / `topUp()` on-chain. Retry memakai exponential backoff 5×, ditambah failover RPC ke validator lain.
- **Reconciler**: setiap 20 detik menanyakan Status API untuk order yang belum terbayar (fallback bila webhook tidak sampai) dan memasukkan ulang job yang hilang.
- **Event listener**: membaca `RedemptionRequested` → simulasi transfer bank → `confirmRedemption()`, sekaligus menyinkronkan status order dari event `DonationRecorded`/`TopUpRecorded`.
- **IPFS**: unggah bukti ke node Kubo lokal (atau Pinata bila `PINATA_JWT` diisi).

Dengan Docker: `docker compose up -d --build oracle`. Konfigurasi dibaca dari `.env` (lihat [.env.example](.env.example)).

**Mode pembayaran:**

1. **`mock`** (default, tanpa akun apa pun): halaman simulator pembayaran mengirim notifikasi bertanda tangan SHA512 ke pipeline verifikasi yang sama dengan Midtrans.
2. **`sandbox`**: isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` dari dashboard Midtrans Sandbox, lalu `docker compose up -d oracle`. Untuk webhook real-time, jalankan `ngrok http 4000` dan set *Payment Notification URL* ke `https://<id>.ngrok-free.app/api/payments/webhook`. Tanpa ngrok pun pembayaran tetap tercatat lewat reconciler (±20 detik). Panduan langkah demi langkah ada di [docs/user-guide.md](docs/user-guide.md#midtrans-sandbox).

Menjalankan oracle di host tanpa container (untuk pengembangan). Infrastruktur tetap memakai Docker dengan port dibuka lewat `docker-compose.dev.yml`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d validator1 validator2 validator3 validator4 ipfs deployer postgres redis
docker compose cp deployer:/deployments/besu.json smart-contract/deployments/besu.json
cd oracle && npm ci && npm test && npm run dev   # default config membaca smart-contract/deployments/besu.json
```

Frontend tanpa Docker: `cd frontend && npm ci && BACKEND_URL=http://localhost:4000 npm run dev`.

## Video demonstrasi

> Link video presentasi dan demo: **_(diisi setelah rekaman)_**

## Lisensi

[MIT](LICENSE)
