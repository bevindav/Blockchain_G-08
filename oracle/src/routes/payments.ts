import { Router } from 'express';
import crypto from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { config } from '../config';
import { pool, getOrder, Order } from '../db';
import { createSnap, mockSettle, MidtransNotification } from '../midtrans';
import { processNotification, requeueOrder } from '../oracle';
import { contracts, orderHash } from '../chain';
import { rateLimit, HttpError } from '../http';

export const payments = Router();

const publicOrder = (o: Order) => ({
  orderId: o.order_id, orderHash: o.order_hash, type: o.type, campaign: o.campaign, donorAddress: o.donor_address,
  donorName: o.donor_name, amount: o.amount, status: o.status, gatewayStatus: o.gateway_status,
  snapToken: o.snap_token, redirectUrl: o.redirect_url, txHash: o.tx_hash, receiptId: o.receipt_id,
  blockNumber: o.block_number, attempts: o.attempts, lastError: o.last_error,
  createdAt: o.created_at, paidAt: o.paid_at, recordedAt: o.recorded_at,
});

/**
 * POST /api/payments/create
 * body: { type: "donation"|"topup", campaign?, amount, donorAddress?, donorName?, donorEmail? }
 */
payments.post('/create', rateLimit(20, 60_000), async (req, res) => {
  const { type = 'donation', campaign, donorName, donorEmail } = req.body ?? {};
  const amount = Number(req.body?.amount);
  if (type !== 'donation' && type !== 'topup') throw new HttpError(400, 'type harus donation atau topup');
  if (!Number.isSafeInteger(amount) || amount < config.minAmount || amount > config.maxAmount)
    throw new HttpError(400, `Nominal harus bilangan bulat Rp${config.minAmount.toLocaleString('id')} - Rp${config.maxAmount.toLocaleString('id')}`);
  if (donorEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(donorEmail)) throw new HttpError(400, 'Email tidak valid');

  let donorAddress: string;
  if (req.body?.donorAddress) {
    if (!isAddress(req.body.donorAddress)) throw new HttpError(400, 'Alamat wallet tidak valid');
    donorAddress = getAddress(req.body.donorAddress);
  } else if (type === 'topup') {
    throw new HttpError(400, 'Top-up dIDR membutuhkan alamat wallet');
  } else {
    donorAddress = config.custodyAddress; // donatur tanpa wallet: kuitansi disimpan di wallet kustodian platform
  }

  let itemName = 'Top-up dIDR';
  let campaignAddress: string | null = null;
  if (type === 'donation') {
    if (!isAddress(campaign)) throw new HttpError(400, 'Alamat campaign tidak valid');
    campaignAddress = getAddress(campaign);
    const c = await contracts();
    if (!(await c.factory.isCampaign(campaignAddress))) throw new HttpError(404, 'Campaign tidak terdaftar');
    const s = await c.campaign(campaignAddress).summary();
    if (Number(s.state) !== 1) throw new HttpError(409, 'Campaign belum aktif atau sudah ditutup');
    if (Number(s.deadline) * 1000 < Date.now()) throw new HttpError(409, 'Campaign sudah melewati deadline');
    // nominal yang masih menunggu pembayaran juga diperhitungkan agar tidak melebihi target
    const { rows } = await pool.query(`SELECT coalesce(sum(amount),0)::text AS s FROM orders WHERE lower(campaign)=lower($1) AND status IN ('QUEUED','PAID')`, [campaignAddress]);
    const remaining = BigInt(s.totalBudget) - BigInt(s.totalDonated) - BigInt(rows[0].s);
    if (BigInt(amount) > remaining) throw new HttpError(409, `Sisa kebutuhan dana campaign hanya Rp${remaining.toLocaleString('id')}`);
    if (BigInt(amount) > BigInt(await c.factory.fiatCap())) throw new HttpError(409, 'Melebihi batas donasi per transaksi');
    itemName = 'Donasi campaign';
  }

  const prefix = type === 'donation' ? 'DON' : 'TOP';
  const orderId = `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const name = String(donorName || 'Hamba Allah').slice(0, 80);
  const snap = await createSnap({ orderId, amount: BigInt(amount), name, email: donorEmail, itemName });
  await pool.query(
    `INSERT INTO orders(order_id, order_hash, type, campaign, donor_address, donor_name, donor_email, amount, status, snap_token, redirect_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CREATED',$9,$10)`,
    [orderId, orderHash(orderId), type, campaignAddress, donorAddress, name, donorEmail || null, amount, snap.token, snap.redirect_url]);
  res.status(201).json({ orderId, orderHash: orderHash(orderId), snapToken: snap.token, redirectUrl: snap.redirect_url,
    mode: config.midtrans.mode, donorAddress, custodial: donorAddress === config.custodyAddress });
});

/**
 * POST /api/payments/webhook - Payment Notification URL Midtrans.
 * Selalu membalas 200 untuk notifikasi yang sudah diproses agar Midtrans tidak mengirim ulang tanpa henti;
 * notifikasi dengan signature salah dibalas 403.
 */
payments.post('/webhook', rateLimit(120, 60_000), async (req, res) => {
  const result = await processNotification(req.body as MidtransNotification, 'webhook');
  res.status(result.verdict.includes('signature') ? 403 : 200).json(result);
});

/** GET /api/payments?address=0x..&campaign=0x.. */
payments.get('/', async (req, res) => {
  const conds: string[] = []; const args: unknown[] = [];
  if (typeof req.query.address === 'string') { args.push(req.query.address); conds.push(`lower(donor_address)=lower($${args.length})`); }
  if (typeof req.query.campaign === 'string') { args.push(req.query.campaign); conds.push(`lower(campaign)=lower($${args.length})`); }
  if (typeof req.query.status === 'string') { args.push(req.query.status); conds.push(`status=$${args.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await pool.query<Order>(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT 100`, args);
  res.json(rows.map(o => ({ ...publicOrder(o), snapToken: undefined })));
});

payments.get('/logs/webhook', async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, order_id, source, signature_valid, verdict, payload, created_at FROM webhook_logs ORDER BY id DESC LIMIT 50`);
  res.json(rows);
});

payments.get('/:orderId', async (req, res) => {
  const o = await getOrder(String(req.params.orderId));
  if (!o) throw new HttpError(404, 'Order tidak ditemukan');
  res.json(publicOrder(o));
});

/** POST /api/payments/:orderId/retry - cek ulang status & retry pencatatan (dipakai tombol "Cek status"). */
payments.post('/:orderId/retry', rateLimit(30, 60_000), async (req, res) => {
  const o = await getOrder(String(req.params.orderId));
  if (!o) throw new HttpError(404, 'Order tidak ditemukan');
  if (o.status === 'FAILED') await requeueOrder(o.order_id);
  else if (o.status === 'CREATED') {
    const { getStatus } = await import('../midtrans');
    const s = await getStatus(o.order_id).catch(() => null);
    if (s) await processNotification(s, 'reconciler');
  }
  res.json(publicOrder((await getOrder(o.order_id))!));
});

/**
 * POST /api/payments/mock/:orderId/:outcome  (hanya mode mock)
 * Simulator payment gateway: menandai transaksi "dibayar" lalu mengirim notifikasi bertanda tangan
 * ke pipeline yang sama dengan webhook Midtrans.
 */
payments.post('/mock/:orderId/:outcome', async (req, res) => {
  if (config.midtrans.mode !== 'mock') throw new HttpError(404, 'Simulator hanya tersedia pada mode mock');
  const o = await getOrder(String(req.params.orderId));
  if (!o) throw new HttpError(404, 'Order tidak ditemukan');
  const outcome = String(req.params.outcome) === 'pay' ? 'settlement' : String(req.params.outcome) === 'expire' ? 'expire' : 'deny';
  const notification = mockSettle(o.order_id, BigInt(o.amount), outcome);
  const result = await processNotification(notification, 'mock');
  res.json({ ...result, notification });
});
