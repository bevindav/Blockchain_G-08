# API Oracle & Backend

Base URL: `http://localhost:4000/api`. Frontend memproksi semua path `/api/*`, jadi endpoint yang sama juga tersedia di `http://localhost:3000/api/*`. Semua body request dan response berformat JSON, kecuali unggahan file (multipart). Bila terjadi error, response berbentuk `{ "error": "pesan" }` dengan status HTTP 4xx/5xx.

## Ringkasan endpoint

| Method | Path | Kegunaan |
| --- | --- | --- |
| GET | `/config` | Alamat kontrak, chainId, RPC publik, role, dan mode pembayaran |
| GET | `/health` | Kesehatan RPC tiap validator, DB, Redis, IPFS, dan antrean oracle |
| POST | `/payments/create` | Membuat order pembayaran (Midtrans Snap / simulator) |
| POST | `/payments/webhook` | **Payment Notification URL** Midtrans (input utama oracle) |
| GET | `/payments/:orderId` | Status order (dipoll frontend) |
| GET | `/payments?address=&campaign=&status=` | Daftar order |
| POST | `/payments/:orderId/retry` | Cek ulang Status API / retry pencatatan |
| POST | `/payments/mock/:orderId/:outcome` | Simulator gateway, hanya mode mock (`pay` / `deny` / `expire`) |
| GET | `/payments/logs/webhook` | 50 log notifikasi terakhir beserta keputusan oracle |
| POST | `/ipfs/upload` | Unggah bukti (multipart `file`) ke IPFS |
| POST | `/ipfs/json` | Unggah metadata campaign ke IPFS |
| GET | `/ipfs/:cid` | Proxy baca konten IPFS |
| POST | `/redemptions/intent` | Mendaftarkan rekening tujuan off-ramp, menghasilkan `bankRef` |
| GET | `/redemptions?account=` | Riwayat penukaran dIDR → rupiah |
| POST | `/faucet` | Mengisi ETH gas ke wallet baru (khusus private chain) |
| GET | `/admin/reconciliation` | Laporan konsistensi order DB ↔ `usedOrders` on-chain |

## Alur pembayaran rupiah

```text
Donatur ──POST /payments/create──▶ Backend ──Snap API──▶ Midtrans
   │                                                       │ (bayar QRIS/VA)
   │                                    webhook ◀──────────┘
   ▼                                       │
GET /payments/:id (poll)      Oracle: 1. verifikasi signature SHA512
                                      2. order ada di DB?
                                      3. GET Status API Midtrans (sumber independen)
                                      4. gross_amount == amount order?
                                      5. transisi status atomik CREATED→QUEUED
                                      6. BullMQ job (jobId unik) → recordFiatDonation() / topUp()
                                         retry backoff 3s·6s·12s·24s·48s + failover RPC
                                      7. RECORDED (txHash, receiptId)
Reconciler (20 dtk): order CREATED → Status API (fallback bila webhook hilang)
Listener   (4 dtk):  event DonationRecorded/TopUpRecorded → sinkronisasi DB
```

## POST `/payments/create`

Request:

```json
{
  "type": "donation",
  "campaign": "0xbf9fBFf01664500A33080Da5d437028b07DFcC55",
  "amount": 50000,
  "donorName": "Budi",
  "donorEmail": "budi@example.com",
  "donorAddress": "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955"
}
```

- `type`: `donation` (ke campaign) atau `topup` (mencetak dIDR ke `donorAddress`, wajib ada wallet).
- `donorAddress` opsional untuk `donation`. Bila kosong, kuitansi NFT dikirim ke wallet kustodian platform dan dapat diverifikasi dengan Order ID.
- Validasi: campaign terdaftar dan aktif, belum lewat deadline, nominal ≤ sisa target (termasuk order yang masih diproses), serta ≤ `fiatCap`.

Response `201`:

```json
{
  "orderId": "DON-1795625106138-7DE1D8",
  "orderHash": "0x613e17a1c11e027f05be435857c6adeea05e760959a914b40090750e05d2769b",
  "snapToken": "66e4fa55-fdac-4ef9-91b5-733b97d1b862",
  "redirectUrl": "https://app.sandbox.midtrans.com/snap/v4/redirection/66e4fa55-...",
  "mode": "sandbox",
  "donorAddress": "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "custodial": false
}
```

`orderHash = keccak256(orderId)` adalah nilai `bytes32` yang dicatat on-chain dan diperiksa keunikannya oleh `CampaignFactory.usedOrders`.

## POST `/payments/webhook`

Payload dari Midtrans (HTTP Notification):

```json
{
  "order_id": "DON-1795625106138-7DE1D8",
  "transaction_status": "settlement",
  "status_code": "200",
  "gross_amount": "50000.00",
  "signature_key": "2496c78cac93a70ca08014bdaaff08eb7119ef79ef69c4833d4399cada077147febc1a231992eb8665a7e26d89b1dc323c13f721d21c7485f70bff06cca6eed3",
  "payment_type": "qris",
  "transaction_id": "513f1f01-c9da-474c-9fc9-d5c64364b709",
  "transaction_time": "2026-11-25 23:45:06",
  "fraud_status": "accept"
}
```

`signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)`.

Response:

```json
{ "ok": true, "verdict": "ACCEPTED: masuk antrean pencatatan on-chain", "status": "QUEUED" }
```

Kemungkinan `verdict`:

| Verdict | Arti | HTTP |
| --- | --- | --- |
| `REJECTED: signature tidak valid` | Pengirim bukan Midtrans / payload dimanipulasi | 403 |
| `REJECTED: order tidak dikenal` | `order_id` tidak pernah dibuat backend | 200 |
| `REJECTED: transaksi tidak ditemukan di payment gateway` | Status API tidak mengenal order (webhook palsu) | 200 |
| `REJECTED: nominal X != order Y` | `gross_amount` tidak sama dengan nominal order | 200 |
| `RETRY: Status API tidak dapat dihubungi…` | Midtrans down, akan dicek reconciler | 200 |
| `PENDING: pembayaran belum selesai` | `pending` / `authorize` / `capture` + challenge | 200 |
| `CLOSED: expire` / `deny` / `cancel` | Pembayaran gagal, order ditutup | 200 |
| `ACCEPTED: masuk antrean…` | Diterima, akan dicatat on-chain | 200 |
| `DUPLICATE: order sudah berstatus …` | Replay / notifikasi berulang, diabaikan | 200 |

## GET `/payments/:orderId`

```json
{
  "orderId": "DON-1795625106138-7DE1D8",
  "orderHash": "0x613e17a1…",
  "type": "donation",
  "campaign": "0xbf9fBFf01664500A33080Da5d437028b07DFcC55",
  "donorAddress": "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "donorName": "Budi",
  "amount": "50000",
  "status": "RECORDED",
  "gatewayStatus": "settlement",
  "txHash": "0xca8fd42124a0e90cf02593a00adfc22e1a3e8b193d6f526f0dc5eaf7ddc1ccb2",
  "receiptId": "3",
  "blockNumber": "25",
  "attempts": 1,
  "lastError": null,
  "createdAt": "2026-11-25T16:45:06.139Z",
  "paidAt": "2026-11-25T16:45:06.208Z",
  "recordedAt": "2026-11-25T16:45:08.480Z"
}
```

Status order: `CREATED` → `QUEUED` → `RECORDED`. Status akhir lain: `FAILED` (sudah dibayar tetapi ditolak kontrak, misalnya target sudah penuh, sehingga perlu refund rupiah), `EXPIRED`, `DENIED`, dan `CANCELLED`.

## POST `/ipfs/upload`

`multipart/form-data` dengan field `file`. Maksimal 5 MB. Tipe file divalidasi dari *magic bytes*: JPG/PNG/WEBP/GIF/PDF.

```json
{
  "cid": "bafkreib3...",
  "hash": "0x9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658",
  "size": 48213,
  "mime": "image/png",
  "name": "invoice-semen.png",
  "uri": "ipfs://bafkreib3..."
}
```

`hash` (keccak256 isi file) dikirim ke `requestWithdrawal(milestone, amount, proofHash, proofCID)` / `submitReport(...)`. Kontrak menolak hash yang sudah pernah dipakai.

## POST `/ipfs/json` — metadata campaign

```json
{
  "title": "Air Bersih untuk Desa Sumber Rejo",
  "description": "Pembangunan sumur bor…",
  "category": "Infrastruktur",
  "organizer": "Yayasan Tirta Nusantara",
  "image": "ipfs://bafkrei...",
  "milestones": [
    { "title": "Pengeboran sumur", "plan": "Sewa alat bor, upah pekerja, uji kualitas air" },
    { "title": "Pipa & tandon", "plan": "Pipa 800 m dan 4 tandon 5.000 L" }
  ]
}
```

Response: `{ "cid": "bafkrei...", "hash": "0x…", "uri": "ipfs://bafkrei..." }`. CID ini menjadi argumen `metadataCID` pada `createCampaign`.

## POST `/redemptions/intent`

```json
{ "account": "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", "bankName": "BCA", "accountNumber": "1234567890", "accountName": "Kepala Desa" }
```

Response: `{ "bankRef": "0x5d1c…", "accountMasked": "******7890" }`. Penerima kemudian memanggil `DonationToken.redeem(amount, bankRef)`. Listener oracle memproses event `RedemptionRequested`, menjalankan transfer bank (disimulasikan), lalu memanggil `confirmRedemption(id, payoutRef)`.

## GET `/config`

```json
{
  "chainId": 1337,
  "rpcUrl": "http://127.0.0.1:8545",
  "startBlock": 4,
  "contracts": { "token": "0x5FbD…", "factory": "0xe7f1…", "receipt": "0xCafa…", "implementation": "0x9f1a…" },
  "roles": { "admin": "0xf39F…", "ngo": "0x7099…", "verifier": "0x3C44…", "oracle": "0x90F7…", "approvers": ["0x15d3…", "0x9965…", "0x976E…"], "threshold": 2 },
  "fiatCap": "100000000",
  "custodyAddress": "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  "ipfsGateway": "http://127.0.0.1:8080/ipfs/",
  "payment": { "mode": "mock", "clientKey": "", "snapJs": "https://app.sandbox.midtrans.com/snap/snap.js", "minAmount": 1000, "maxAmount": 100000000 }
}
```

## GET `/health`

```json
{
  "ok": true,
  "rpc": [ { "url": "http://validator1:8545", "ok": true, "block": 356 }, { "url": "http://validator2:8545", "ok": true, "block": 356 } ],
  "db": true, "redis": true, "ipfs": true,
  "queue": { "waiting": 0, "active": 0, "delayed": 0, "failed": 0, "completed": 12 },
  "paymentMode": "mock"
}
```

## Midtrans API yang dipakai oracle

| API | Endpoint (sandbox) | Kegunaan |
| --- | --- | --- |
| Snap | `POST https://app.sandbox.midtrans.com/snap/v1/transactions` | Membuat transaksi dan token popup |
| Status | `GET https://api.sandbox.midtrans.com/v2/{order_id}/status` | Verifikasi ulang status dan nominal |
| Notification | `POST {NOTIFICATION_URL}/api/payments/webhook` | Push status dari Midtrans |

Autentikasi memakai header `Authorization: Basic base64(ServerKey + ":")`.
