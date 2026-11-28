# Keamanan & Optimasi Gas

## Pemetaan OWASP Smart Contract Top 10 (2025)

| # | Risiko | Mitigasi di kontrak | Bukti (test) |
| --- | --- | --- | --- |
| SC01 | Access control | `AccessControl` OpenZeppelin untuk NGO/verifier/oracle/admin; modifier `onlyNgo`, `onlyApprover`, dan `onlyRole` (cek live ke factory); `initialize` hanya sekali dan implementasi dikunci di constructor; `consumeOrder`/`consumeProof` hanya dari campaign terdaftar; mint receipt hanya dari campaign terdaftar | *restricts every privileged action to its role*, *cannot re-initialize a campaign clone* |
| SC02 | Price oracle manipulation | Lihat bagian oracle di bawah: tidak memakai harga on-chain; nilai rupiah diverifikasi dari 2 sumber (webhook bertanda tangan + Status API); `fiatCap` membatasi dampak per transaksi | *caps every fiat transaction* |
| SC03 | Logic errors | Invarian `paid + reserved ≤ budget` per milestone, `reserved ≤ saldo escrow`, `totalDonated ≤ target`; state machine eksplisit; reservasi dilepas saat reject/cancel/cancel campaign | *enforces milestone budgets…*, *auto-rejects when quorum becomes impossible* |
| SC04 | Lack of input validation | Custom error untuk alamat nol, nominal nol, deadline lampau, milestone kosong/nol, threshold tidak valid, approver duplikat, CID/hash bukti kosong, recipient tidak terdaftar | *rejects unregistered recipients and invalid campaign configs* |
| SC05 | Reentrancy | `ReentrancyGuard` pada `donate`, `recordFiatDonation`, `executeWithdrawal`, dan `claimRefund`; pola Checks-Effects-Interactions (state diubah sebelum transfer token); token yang dipakai adalah kontrak internal (tanpa hook) | Slither: tidak ada temuan *reentrancy-eth*/*reentrancy-no-eth* |
| SC06 | Unchecked external calls | `SafeERC20` untuk semua transfer; panggilan ke factory/receipt akan revert seluruh transaksi bila gagal | — |
| SC07 | Flash loan attacks | Tidak ada harga/likuiditas on-chain yang bisa dimanipulasi dalam satu blok; persetujuan butuh N akun berbeda di transaksi berbeda | — |
| SC08 | Integer overflow | Solidity 0.8 checked arithmetic; downcast ke `uint128`/`uint88` dibatasi (`AmountTooLarge`, target ≤ jumlah `uint128`) | — |
| SC09 | Insecure randomness | Tidak memakai randomness | — |
| SC10 | Denial of service | Tidak ada loop tak terbatas pada fungsi bertransaksi (loop hanya saat `initialize` atas input pembuat campaign); refund memakai pola *pull* per donatur, bukan iterasi semua donatur; pencairan selalu ke satu recipient | *refunds donors proportionally…* |

Kontrol tambahan:

- **Duplikasi**: `usedOrders` global (fiat donation dan top-up) dan `usedProofs` global (bukti pencairan dan laporan) mencegah pencatatan ganda maupun pemakaian ulang bukti antar campaign (FR-08).
- **Dana hanya ke recipient terdaftar**: alamat recipient dikunci di campaign dan harus terdaftar di registry verifikator.
- **Pemisahan wewenang**: NGO tidak bisa mencairkan tanpa N approver; oracle tidak bisa memindahkan dana escrow; verifikator tidak bisa mencairkan dana.
- **Circuit breaker**: `DonationToken.pause()` menghentikan seluruh transfer, mint, donasi, dan pencairan.
- **Soulbound receipt**: transfer, approve, dan burn kuitansi ditolak (`Soulbound`).

## Mitigasi oracle manipulation

Sesuai panduan <https://scsfg.io/hackers/oracle-manipulation/>, oracle pada sistem ini adalah *payment oracle* (bukan *price oracle*). Ancaman dan mitigasinya:

| Ancaman | Mitigasi |
| --- | --- |
| Webhook palsu dari pihak luar | Verifikasi `signature_key = SHA512(order_id+status_code+gross_amount+ServerKey)` dengan `timingSafeEqual`; ditolak HTTP 403 |
| Webhook asli di-*replay* / notifikasi ganda | Transisi status atomik di DB (`UPDATE … WHERE status = ANY(...)`), `jobId` BullMQ unik per order, dan `usedOrders` on-chain sebagai lapisan terakhir |
| Isi webhook dimanipulasi (mis. status atau nominal) | Oracle **tidak mempercayai payload**: status dan nominal diambil ulang dari **Status API Midtrans** (sumber independen) |
| Nominal tidak sesuai order | `gross_amount` Status API harus sama persis dengan nominal yang dibuat backend; pecahan sen ditolak |
| Order fiktif | Order harus dibuat lebih dulu oleh backend dan tersimpan di DB |
| Kunci oracle bocor | `ORACLE_ROLE` hanya bisa mencatat donasi (tidak bisa menarik dana); `fiatCap` per transaksi; admin dapat mencabut role dan mem-pause token; semua pencatatan publik dan dapat direkonsiliasi |
| Ketersediaan (RPC/Midtrans down) | Retry exponential backoff 5×, failover RPC antar validator, reconciler Status API setiap 20 detik, checkpoint listener di DB, laporan konsistensi DB ↔ chain |
| Front-running | Tidak relevan: gas price 0, validator teridentifikasi (permissioned), dan tidak ada transaksi yang nilainya bergantung pada urutan |

Pengujian manual yang dilakukan:

```text
webhook signature acak                  -> REJECTED: signature tidak valid (403)
signature valid, transaksi tidak ada    -> REJECTED: transaksi tidak ditemukan di payment gateway
pembayaran valid                        -> ACCEPTED -> RECORDED (±2 detik)
replay notifikasi yang sama             -> DUPLICATE: order sudah berstatus RECORDED
validator1 dimatikan saat pencatatan    -> [rpc] failover ke validator2 -> RECORDED
```

## Privasi (IPFS bersifat publik)

- Nama dan email donatur hanya disimpan off-chain di PostgreSQL, tidak pernah on-chain.
- Data rekening penerima hanya disimpan off-chain; on-chain hanya `bankRef = keccak256(data || salt acak)`.
- Unggahan bukti dibatasi ke gambar/PDF (divalidasi dari *magic bytes*), maksimal 5 MB. UI mengingatkan agar data pribadi (NIK, wajah anak, nomor rekening) disamarkan.
- Proxy IPFS mengirim header `Content-Security-Policy: sandbox` dan `X-Content-Type-Options: nosniff` agar file unggahan tidak dapat mengeksekusi skrip di origin aplikasi.

## Analisis statis (Slither)

Laporan lengkap: [security/slither-report.txt](security/slither-report.txt) (Slither, 102 detector, tanpa dependency).

| Temuan | Tingkat | Tanggapan |
| --- | --- | --- |
| `reentrancy-benign` pada `createCampaign` | Low | Panggilan eksternal hanya ke kontrak internal tepercaya (receipt, token, dan clone yang baru dibuat). Fungsi `onlyRole(NGO_ROLE)` |
| `timestamp` pada `activate`, `_validateDonation`, dan `initialize` | Informational | Deadline berskala hari; manipulasi timestamp oleh validator (±detik) tidak berdampak, dan validator permissioned |
| `missing-inheritance` (IDonationToken/IDonationReceipt) | Informational | Interface minimal yang sengaja dipisah untuk mengurangi ukuran bytecode Campaign |

Temuan reentrancy lain yang sempat muncul sudah diperbaiki dengan mengurutkan ulang menjadi Checks-Effects-Interactions (`requestWithdrawal`, `recordFiatDonation`, `submitReport`, `topUp`).

## Optimasi gas

| Teknik | Lokasi | Dampak |
| --- | --- | --- |
| **EIP-1167 minimal proxy (Clones)** | `CampaignFactory.createCampaign` | ±591 ribu gas per campaign, dibanding ±3,18 juta gas untuk deploy kontrak Campaign penuh (**hemat ±81%**) |
| **Custom error** alih-alih `require(string)` | semua kontrak | Bytecode lebih kecil dan revert lebih murah |
| **Struct packing** | `Withdrawal` (amount·milestone·approvals·rejections·status·requestedAt = 1 slot), `Milestone` (uint128), `Redemption` (address + uint88 + enum = 1 slot), `Receipt` (address + uint64), slot 0 Campaign (factory + deadline + state + threshold + approverCount) | Mengurangi jumlah `SSTORE` |
| **Data yang tidak dibaca kontrak disimpan di event** | `proofCID` di `WithdrawalRequested`/`ReportSubmitted`, alasan reject/cancel | Hanya `bytes32` hash yang disimpan di storage |
| **Metadata kuitansi on-chain bersifat `view`** | `DonationReceipt.tokenURI` | Gambar dan JSON dibangkitkan saat dibaca (gratis), tanpa storage tambahan |
| **`immutable`** | `factory`, `token`, `receipt`, `implementation` di factory/receipt | Dibaca dari bytecode, bukan storage |
| **`unchecked` increment** | `donationCount`, `approvals`, `rejections` | Nilai dibatasi secara alami |
| **View agregat `summary()`** | Campaign | Frontend cukup 1 RPC call untuk seluruh ringkasan |

Laporan gas lengkap dari `hardhat-gas-reporter`: [gas-report.txt](gas-report.txt). Ringkasan rata-rata gas per fungsi:

| Fungsi | Gas rata-rata |
| --- | --- |
| `createCampaign` (2-3 milestone) | ±591.000 |
| `recordFiatDonation` (+ mint dIDR + mint kuitansi NFT) | ±354.000 |
| `donate` (dIDR, + mint kuitansi NFT) | ±260.000 |
| `requestWithdrawal` | ±177.000 |
| `approveWithdrawal` | ±61.000 |
| `executeWithdrawal` | ±94.000 |
| `claimRefund` | ±94.000 |
| `submitReport` | ±67.000 |
| `redeem` | ±79.000 |

Pengujian: 21 unit test kontrak dengan coverage **100% baris**, 97% statement, dan 81% branch (`npm run coverage`); 5 unit test oracle (signature, klasifikasi status, parsing nominal); serta uji E2E UI multi-role.
