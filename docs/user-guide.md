# User Guide — DonasiTransparan

## Daftar isi

1. [Instalasi](#1-instalasi)
2. [Deploy smart contract, oracle, dan frontend](#2-deploy-smart-contract-oracle-dan-frontend)
3. [Menyiapkan MetaMask](#3-menyiapkan-metamask)
4. [Midtrans Sandbox (opsional)](#midtrans-sandbox)
5. [Use case per role](#5-use-case-per-role)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Instalasi

Prasyarat:

- **Docker Desktop** (Windows/macOS) atau **Docker Engine + Compose v2** (Linux). Windows memerlukan WSL2.
- **Git**.
- Browser dengan ekstensi **MetaMask**.
- RAM bebas ±6 GB. Bila RAM terbatas, set `BESU_HEAP=384m` di `.env`.

```bash
git clone https://github.com/bevindav/Blockchain_G-08.git
cd Blockchain_G-08
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Node.js 22 hanya diperlukan bila ingin menjalankan test atau mode pengembangan tanpa Docker.

## 2. Deploy smart contract, oracle, dan frontend

### Satu perintah (disarankan)

```bash
docker compose up -d --build
```

Urutan yang dijalankan otomatis oleh Docker Compose:

| # | Service | Keterangan |
| --- | --- | --- |
| 1 | `besu-init` | Membuat genesis QBFT + key 4 validator (sekali saja) |
| 2 | `validator1..4` | Private chain Besu; RPC di `localhost:8545` dan `localhost:8546` |
| 3 | `ipfs` | Node IPFS Kubo; gateway di `localhost:8080` |
| 4 | `deployer` | Compile dan deploy kontrak, memberi role, lalu seed 2 campaign demo. Dilewati bila kontrak sudah ada |
| 5 | `postgres`, `redis` | Database order dan antrean oracle |
| 6 | `oracle` | API + payment oracle + listener + reconciler di `localhost:4000` |
| 7 | `frontend` | Web app di **http://localhost:3000** |

Cek status:

```bash
docker compose ps                         # deployer harus "Exited (0)", lainnya "Up"
docker compose logs deployer              # alamat kontrak hasil deploy
curl http://localhost:4000/api/health     # {"ok":true,...}
```

Menghentikan atau mereset:

```bash
docker compose down        # stop, data tetap
docker compose up -d       # jalankan lagi (chain melanjutkan blok terakhir)
docker compose down -v     # reset total (chain baru, kontrak di-deploy ulang)
```

### Deploy manual per komponen

**Smart contract** (dari host, chain sudah berjalan):

```bash
cd smart-contract
npm ci
npm test                    # 21 test
npm run deploy:besu         # -> smart-contract/deployments/besu.json
npm run seed:besu           # opsional
```

**Oracle** (mode pengembangan, infrastruktur memakai Docker):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d validator1 validator2 validator3 validator4 ipfs deployer postgres redis
docker compose cp deployer:/deployments/besu.json smart-contract/deployments/besu.json
cd oracle && npm ci && npm run dev        # http://localhost:4000
```

**Frontend** (mode pengembangan):

```bash
cd frontend && npm ci
BACKEND_URL=http://localhost:4000 npm run dev      # http://localhost:3000
```

(PowerShell: `$env:BACKEND_URL='http://localhost:4000'; npm run dev`.)

## 3. Menyiapkan MetaMask

### Menambahkan jaringan

Klik **Hubungkan MetaMask** di web. Aplikasi otomatis meminta MetaMask menambahkan dan berpindah ke jaringan **DonasiChain (Besu QBFT)**. Bila ingin menambahkannya manual:

| Field | Nilai |
| --- | --- |
| Network name | DonasiChain (Besu QBFT) |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `1337` |
| Currency symbol | ETH |

Gas price jaringan ini 0, dan wallet baru otomatis mendapat 100 ETH dari faucet saat pertama kali terhubung.

### Akun demo

Genesis mendanai 10 akun development Hardhat (mnemonic publik `test test test test test test test test test test test junk`). **Jangan pernah memakai akun ini di jaringan publik.** Impor private key berikut di MetaMask (*Add account → Import account*) sesuai role yang ingin dicoba:

| # | Role | Alamat | Private key |
| --- | --- | --- | --- |
| 0 | Admin platform | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| 1 | NGO | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| 2 | Verifikator | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| 3 | Oracle (dipakai backend) | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | — |
| 4 | Approver 1 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |
| 5 | Approver 2 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` | `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba` |
| 6 | Approver 3 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` | `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` |
| 7 | Donatur | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` | `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356` |
| 8 | Penerima manfaat (terdaftar) | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` | `0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97` |
| 9 | Faucet & kustodian (dipakai backend) | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` | — |

Persetujuan pencairan membutuhkan **2 dari 3** approver.

## Midtrans Sandbox

Tanpa konfigurasi, sistem berjalan dalam mode **mock**: tombol bayar membuka halaman simulator QRIS. Simulator tetap mengirim notifikasi bertanda tangan SHA512 ke pipeline verifikasi oracle yang sama. Untuk memakai **Midtrans Sandbox** sungguhan:

1. Daftar akun gratis di <https://dashboard.sandbox.midtrans.com/register>.
2. Buka **Settings → Access Keys** (pastikan mode *Sandbox* aktif di pojok kiri atas), lalu salin **Server Key** (`SB-Mid-server-…`) dan **Client Key** (`SB-Mid-client-…`).
3. Isi `.env`:

   ```env
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxx
   ```

4. Terapkan konfigurasi: `docker compose up -d oracle`. Footer web akan menampilkan `pembayaran: sandbox`.
5. **(Opsional, untuk webhook real-time)** Pasang ngrok (<https://ngrok.com/download>), login dengan `ngrok config add-authtoken <token>`, lalu:

   ```bash
   ngrok http 4000
   ```

   Salin URL `https://xxxx.ngrok-free.app`, lalu di dashboard Midtrans buka **Settings → Payment → Notification URL** dan isi `https://xxxx.ngrok-free.app/api/payments/webhook`. Klik *Test notification URL*. Respons 200/403 menandakan URL sudah terjangkau (403 wajar untuk test karena signature-nya dummy).

   Tanpa ngrok, pembayaran **tetap tercatat**: reconciler oracle menanyakan Status API Midtrans setiap 20 detik.

6. Saat membayar di popup Snap, pilih **QRIS** atau **GoPay**. Untuk menyelesaikan pembayaran, buka simulator Midtrans <https://simulator.sandbox.midtrans.com/>, pilih metode yang sama (mis. *QRIS*), lalu tempel URL QR / kode dari popup. Untuk **Virtual Account** (mis. BCA VA), salin nomor VA ke simulator *Virtual Account → BCA*.
7. Pantau proses di `docker compose logs -f oracle` atau di **Dashboard → Status sistem & oracle**.

---

## 5. Use case per role

### Donatur tanpa wallet (awam)

1. Buka beranda → pilih campaign → tab **Rupiah (QRIS / VA)**.
2. Isi nominal (nama/email opsional) → **Bayar**.
3. Selesaikan pembayaran (simulator atau Midtrans Snap).
4. Halaman status menampilkan tahapan *Order dibuat → Terverifikasi → Antrean oracle → Tercatat on-chain* beserta **tx hash**, nomor blok, dan nomor kuitansi.
5. Simpan **Order ID**. Di menu **Cek Kuitansi**, masukkan Order ID untuk memverifikasi kuitansi NFT (dipegang wallet kustodian platform).

### Donatur dengan wallet

1. **Hubungkan MetaMask** (akun #7).
2. **Dashboard → Donatur → Top-up**: bayar rupiah untuk mendapatkan dIDR (dicetak oracle ke wallet Anda).
3. Di halaman campaign, pilih tab **dIDR (MetaMask)** → **Donasi**. Akan muncul 2 transaksi: `approve` lalu `donate`. Status transaksi tampil di pojok kanan bawah.
4. Alternatif: donasi rupiah dengan centang *Kirim kuitansi NFT ke wallet saya*.
5. **Cek Kuitansi** menampilkan semua kuitansi milik wallet. Kuitansi tidak dapat dipindahtangankan.
6. Bila campaign dibatalkan, buka campaign → panel **Refund** → **Klaim refund dIDR**.

### NGO (penyelenggara)

1. Hubungkan akun #1 (punya `NGO_ROLE`).
2. **Buat Campaign**: isi judul, deskripsi, kategori, deadline, gambar, **wallet penerima terdaftar** (mis. akun #8), serta daftar milestone (judul, rencana penggunaan, nominal). Klik kirim: metadata diunggah ke IPFS, lalu `createCampaign` ditandatangani.
3. Tunggu verifikator mengaktifkan campaign.
4. Setelah dana masuk, panel **Ajukan pencairan**: pilih milestone, nominal, dan unggah bukti (invoice/RAB) → **Ajukan**. Hash file dicatat on-chain; bukti yang sama tidak bisa dipakai lagi.
5. Setelah 2 approver menyetujui, tab **Pencairan** → **Eksekusi pencairan ke penerima**. dIDR terkirim ke wallet penerima terdaftar.
6. Unggah **laporan penyaluran** (foto distribusi, kuitansi vendor) pada pencairan yang sudah dieksekusi.
7. Bisa membatalkan pengajuan yang belum dieksekusi, atau membatalkan campaign (sisa dana menjadi refund donatur).

### Verifikator

1. Hubungkan akun #2.
2. **Dashboard → Verifikator → Registri wallet penerima**: daftarkan wallet penerima yang sudah diverifikasi identitasnya (atau cabut pendaftarannya).
3. **Campaign menunggu verifikasi** → buka campaign → periksa → **Verifikasi & aktifkan**.
4. Bila ditemukan kecurangan: **Batalkan campaign** dengan alasan (tercatat on-chain), sehingga donatur dapat mengklaim refund.

### Approver (auditor independen)

1. Hubungkan akun #4/#5/#6.
2. **Dashboard → Approver pencairan** menampilkan pengajuan yang menunggu suara Anda.
3. Buka campaign → tab **Pencairan** → periksa bukti (**Lihat bukti** dan **verifikasi hash**) → **Setujui** atau **Tolak** (dengan alasan).
4. Pengajuan otomatis berstatus *Disetujui* setelah 2 suara setuju, atau *Ditolak* bila 2 approver menolak (kuorum mustahil tercapai). Approver juga dapat mengeksekusi pencairan yang sudah disetujui.

### Penerima manfaat

1. Hubungkan akun #8.
2. Di campaign → tab **Pencairan**, unggah **laporan / bukti penyaluran** untuk pencairan yang sudah diterima.
3. **Dashboard → Penerima manfaat**: isi nominal dan rekening → **Tukar dIDR ke rupiah**. dIDR dibakar on-chain, oracle off-ramp mentransfer dana (disimulasikan), lalu mengonfirmasi on-chain. Status berubah menjadi **PAID** dengan tx konfirmasi.

### Admin platform

1. Hubungkan akun #0.
2. **Dashboard → Admin**: beri `NGO_ROLE` ke NGO baru, ubah batas donasi fiat per transaksi, dan **Pause darurat** (menghentikan seluruh pergerakan dIDR).
3. **Status sistem & oracle**: kesehatan RPC tiap validator, DB, Redis, IPFS, antrean, log seluruh notifikasi pembayaran beserta keputusan oracle, dan tombol **rekonsiliasi DB ↔ blockchain**.

### Publik / auditor eksternal

- Halaman campaign → **Jejak dana (on-chain)**: timeline lengkap dari event log, mulai dari pembuatan campaign, verifikasi, setiap donasi, pengajuan + bukti, persetujuan, pencairan ke penerima, laporan, hingga transfer bank penerima.
- **Explorer**: blok terbaru (proposer validator), detail transaksi, fungsi yang dipanggil, dan event yang sudah di-decode.

## 6. Troubleshooting

| Masalah | Solusi |
| --- | --- |
| `deployer` gagal / oracle tidak start | `docker compose logs deployer`. Bila chain belum siap, jalankan `docker compose up -d` lagi |
| Halaman “Memuat konfigurasi blockchain…” terus | Oracle belum siap; cek `docker compose logs oracle` |
| MetaMask: *nonce too high* / transaksi macet setelah `down -v` | MetaMask → Settings → Advanced → **Clear activity tab data** (chain baru, nonce kembali 0) |
| MetaMask sudah punya jaringan lain dengan chainId 1337 | Hapus jaringan lama atau ubah RPC-nya ke `http://127.0.0.1:8545` |
| Transaksi gagal dengan pesan merah | Pesan menjelaskan alasan revert (mis. *Bukti ini sudah pernah dipakai*, *Akun Anda tidak memiliki hak*). Simulasi dilakukan sebelum MetaMask terbuka |
| Pembayaran sandbox tidak tercatat | Tunggu ±20 detik (reconciler) atau klik **Cek status ke gateway** di halaman status; periksa key di `.env` |
| RAM penuh | Set `BESU_HEAP=384m` di `.env`, lalu `docker compose up -d` |
| Port bentrok (3000/4000/8545/8080) | Hentikan aplikasi lain yang memakai port tersebut, atau ubah mapping `ports` di `docker-compose.yml` |
