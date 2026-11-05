# Blockchain G-08

## Tech Stack
- Node.js 22 LTS dan npm (validasi pada Node 22.6.0).
- Solidity 0.8.24, Hardhat 2.28.0, ethers 6, OpenZeppelin 5.0.2, Mocha/Chai.
- Docker Desktop dengan Linux engine + Compose dan PowerShell untuk private network Besu 24.12.0 QBFT. Docker tidak diperlukan untuk compile/test/Hardhat lokal.
- Akses npm registry saat instalasi pertama. solc-js dipin di package-lock

## Struktur

```text
frontend/                  
oracle/                    
smart-contract/
  contracts/               
  scripts/deploy.js        
  test/donation.js         
  hardhat.config.js
  network/                 
docs/                      
```

## Compile, test, deploy on local Hardhat

```powershell
cd smart-contract
npm ci
npm run compile
npm test
npm run node -- --hostname 127.0.0.1
```

Di terminal kedua, dari `smart-contract`:

```powershell
npm run deploy:local
```

Default RPC `http://127.0.0.1:8545`. Jika pakai port lain, jalankan node dengan `--port 18545` dan set `$env:LOCAL_RPC_URL = 'http://127.0.0.1:18545'` pada terminal deployment. `npm run deploy` memakai network Hardhat sementara yang hilang setelah proses selesai. Gunakan `deploy:local` untuk node yang sedang berjalan.

Script men-deploy token dan factory, lalu factory akan membuat receipt. Script juga memberikan token admin role ke factory dan NGO_ROLE ke akun NGO. Pada Hardhat, akun 0 = admin, 1 = NGO, 2 = verifier, 3 = oracle, 4–5 = approver (2-of-2). Alamat hasil disimpan di `smart-contract/deployments/<network>.json`. Campaign dibuat setelah deployment oleh NGO menggunakan `createCampaign(recipient, [budget1, budget2, ...])`; verifier kemudian memanggil `activate()`.

Satu unit token = Rp1. Donatur token menjalankan `approve(campaign, amount)` lalu `donate(amount)`. Untuk simulasi fiat, signer oracle memanggil `recordFiatDonation(ethers.id(orderId), donor, amount)`. Token dimint ke escrow dan NFT dimint ke donor. NGO mengajukan `requestWithdrawal(milestoneIndex, amount)`, approver memanggil `approveWithdrawal(requestId)`, lalu NGO `executeWithdrawal(requestId)`; dana dIDR selalu menuju recipient terdaftar.

## Private blockchain QBFT
```powershell
powershell -ExecutionPolicy Bypass -File smart-contract/network/setup.ps1
docker compose -f smart-contract/network/generated/compose.yaml up -d
docker compose -f smart-contract/network/generated/compose.yaml logs --tail 30
```

Setup menghasilkan genesis engan validator extraData, empat private key acak, data directory, dan compose.yaml. Script akan menolak write jika directory generated sudah ada. Untuk restart, cukup `docker compose ... up -d`; untuk menghentikan, `docker compose -f smart-contract/network/generated/compose.yaml down`.


Periksa empat validator dan blok:

```powershell
Invoke-RestMethod http://127.0.0.1:8545 -Method Post -ContentType application/json -Body '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
Invoke-RestMethod http://127.0.0.1:8545 -Method Post -ContentType application/json -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Untuk deploy Besu, dari `smart-contract`, set environment berikut. Alamat contoh adalah akun development Hardhat yang publik, gunakan hanya pada chain lokal. Key di bawah adalah key akun development pertama yang didanai genesis, bukan secret produksi.

```powershell
$env:DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
$env:NGO_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
$env:VERIFIER_ADDRESS = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
$env:ORACLE_ADDRESS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
$env:APPROVER_1_ADDRESS = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
$env:APPROVER_2_ADDRESS = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'
npm run deploy:besu
```

Besu tidak membuka akun signer melalui RPC, ethers menandatangani transaksi dengan key lokal. `BESU_RPC_URL` opsional (default localhost:8545). Deployment hanya memerlukan key admin, interaksi role lain memerlukan key wallet masing-masing.

## Progress
Done:smart contract, role NGO/verifier/oracle/approver, aktivasi, donasi token dan fiat mock, registry order global anti-duplikasi, escrow, milestone/reservasi, multi-approval, pencairan satu kali, NFT soulbound, events, deployment, dan unit tests.

To do: frontend, layanan oracle, Midtrans nyata, redeem/transfer bank, IPFS, PostgreSQL, Redis/BullMQ, explorer, monitoring, CI/CD, refund, pembatalan withdrawal,  audit keamanan.  

# Desain smart contract

Solidity 0.8.24 dan OpenZeppelin 5.0.2. Satu unit dIDR = Rp1 (decimals=0). dIDR adalah representasi akuntansi, belum memiliki redeem rupiah.

| Kontrak | Properties | Methods utama | Events |
| --- | --- | --- | --- |
| DonationToken | MINTER_ROLE, balanceOf, totalSupply | mint, transfer, approve, transferFrom, grantRole, revokeRole | Transfer, Approval, RoleGranted, RoleRevoked |
| CampaignFactory | NGO_ROLE, token, receipt, verifier, oracle, threshold, campaigns, isCampaign, usedOrders | createCampaign, campaignCount, consumeOrder | CampaignCreated |
| Campaign | ngo, recipient, verifier, oracle, threshold, isApprover, state, milestones, withdrawals, approved, totalBudget, totalDonated, totalPaid, reserved | activate, donate, recordFiatDonation, requestWithdrawal, approveWithdrawal, executeWithdrawal | Activated, DonationRecorded, WithdrawalRequested, WithdrawalApproved, WithdrawalExecuted, Completed |
| DonationReceipt | factory, campaigns, nextId, receipts | registerCampaign, mint, ownerOf | Transfer saat mint |