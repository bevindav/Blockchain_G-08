import { Router } from 'express';
import crypto from 'node:crypto';
import { getAddress, isAddress, parseEther, formatEther, id } from 'ethers';
import { config, deployment } from '../config';
import { pool } from '../db';
import { rpcHealth, faucetSigner, getProvider } from '../chain';
import { HttpError, rateLimit } from '../http';
import { consistencyReport } from '../reconciler';
import { chainQueue, redis } from '../oracle';

export const misc = Router();

/** GET /api/config - alamat kontrak & parameter publik yang dibutuhkan frontend. */
misc.get('/config', (_req, res) => {
  const d = deployment();
  res.json({
    chainId: d.chainId, rpcUrl: config.publicRpcUrl, startBlock: d.startBlock,
    contracts: { token: d.token, factory: d.factory, receipt: d.receipt, implementation: d.implementation },
    roles: { admin: d.admin, ngo: d.ngo, verifier: d.verifier, oracle: d.oracle, approvers: d.approvers, threshold: d.threshold },
    fiatCap: d.fiatCap, custodyAddress: config.custodyAddress, ipfsGateway: config.publicIpfsGateway,
    payment: { mode: config.midtrans.mode, clientKey: config.midtrans.clientKey, snapJs: config.midtrans.snapJs,
      minAmount: config.minAmount, maxAmount: config.maxAmount },
  });
});

misc.get('/health', async (_req, res) => {
  const [rpc, db, cache, ipfs] = await Promise.all([
    rpcHealth(),
    pool.query('SELECT 1').then(() => true, () => false),
    redis.ping().then(() => true, () => false),
    fetch(`${config.ipfsApiUrl}/api/v0/id`, { method: 'POST', signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false),
  ]);
  const queue = await chainQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed').catch(() => null);
  const ok = rpc.some(r => r.ok) && db && cache;
  res.status(ok ? 200 : 503).json({ ok, rpc, db, redis: cache, ipfs, queue, paymentMode: config.midtrans.mode });
});

const faucetHits = new Map<string, number>();
/** POST /api/faucet {address} - mengirim ETH gas ke wallet baru (private chain saja). */
misc.post('/faucet', rateLimit(10, 60_000), async (req, res) => {
  if (!isAddress(req.body?.address)) throw new HttpError(400, 'Alamat tidak valid');
  const address = getAddress(req.body.address);
  const last = faucetHits.get(address) ?? 0;
  if (Date.now() - last < 60_000) throw new HttpError(429, 'Tunggu 1 menit sebelum meminta lagi');
  const provider = await getProvider();
  const balance = await provider.getBalance(address);
  if (balance >= parseEther('10')) return res.json({ skipped: true, balance: formatEther(balance) });
  faucetHits.set(address, Date.now());
  const tx = await (await faucetSigner()).sendTransaction({ to: address, value: parseEther('100') });
  const rc = await tx.wait(1, 30_000);
  res.json({ txHash: rc?.hash, amount: '100' });
});

/**
 * POST /api/redemptions/intent {account, bankName, accountNumber, accountName}
 * Data rekening disimpan off-chain; yang ditulis on-chain hanya bankRef (hash ber-salt) demi privasi.
 */
misc.post('/redemptions/intent', rateLimit(20, 60_000), async (req, res) => {
  const { account, bankName, accountNumber, accountName } = req.body ?? {};
  if (!isAddress(account)) throw new HttpError(400, 'Alamat wallet tidak valid');
  if (!bankName || !/^\d{6,20}$/.test(String(accountNumber ?? '')) || !accountName)
    throw new HttpError(400, 'Data rekening tidak lengkap / nomor rekening harus 6-20 digit');
  const bankRef = id(`${bankName}|${accountNumber}|${accountName}|${crypto.randomBytes(16).toString('hex')}`);
  const masked = String(accountNumber).replace(/\d(?=\d{4})/g, '*');
  await pool.query('INSERT INTO redemption_intents(bank_ref, account, bank_name, account_masked, account_name) VALUES ($1,$2,$3,$4,$5)',
    [bankRef, getAddress(account), String(bankName).slice(0, 40), masked, String(accountName).slice(0, 80)]);
  res.status(201).json({ bankRef, accountMasked: masked });
});

misc.get('/redemptions', async (req, res) => {
  const args: unknown[] = [];
  let where = '';
  if (typeof req.query.account === 'string') { args.push(req.query.account); where = 'WHERE lower(r.account)=lower($1)'; }
  const { rows } = await pool.query(
    `SELECT r.*, i.bank_name, i.account_masked, i.account_name FROM redemptions r
     LEFT JOIN redemption_intents i ON i.bank_ref = r.bank_ref ${where} ORDER BY r.id DESC LIMIT 100`, args);
  res.json(rows);
});

misc.get('/admin/reconciliation', async (_req, res) => {
  res.json(await consistencyReport());
});
