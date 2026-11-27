import { Queue, Worker, UnrecoverableError, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import { getOrder, transition, updateOrder, logWebhook, pool } from './db';
import { MidtransNotification, classify, getStatus, parseGrossAmount, verifySignature } from './midtrans';
import { contracts, decodeError, oracleSigner, orderHash, PERMANENT_ERRORS, campaignIface, factoryIface } from './chain';

export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

type RecordJob = { kind: 'record-order'; orderId: string };
type ConfirmRedemptionJob = { kind: 'confirm-redemption'; redemptionId: string; payoutRef: string };
export type ChainJob = RecordJob | ConfirmRedemptionJob;

export const chainQueue = new Queue<ChainJob>('chain-tx', {
  connection: redis,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 3000 }, // 3s, 6s, 12s, 24s, 48s
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export async function enqueueOrder(orderId: string) {
  // jobId = orderId -> BullMQ menolak job ganda untuk order yang sama selama job masih ada.
  const jobId = `order-${orderId}`;
  const existing = await chainQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') await existing.remove();
    else return; // masih menunggu / sedang diproses
  }
  await chainQueue.add('record-order', { kind: 'record-order', orderId }, { jobId });
}

/** Retry manual (dipakai reconciler & endpoint admin) untuk order FAILED atau QUEUED yang job-nya hilang. */
export async function requeueOrder(orderId: string) {
  await transition(orderId, ['FAILED'], 'QUEUED', { last_error: null });
  await enqueueOrder(orderId);
}

export type ProcessResult = { ok: boolean; verdict: string; status?: string };

/**
 * Pipeline verifikasi oracle untuk setiap notifikasi pembayaran (webhook, reconciler, atau simulator):
 *  1. verifikasi signature SHA512 (autentikasi pengirim)
 *  2. order harus ada di database kita (menolak order fiktif)
 *  3. cek ulang status ke Midtrans Status API (sumber independen; menolak webhook palsu/replay)
 *  4. nominal Status API == nominal order (menolak manipulasi nominal)
 *  5. transisi status atomik + job id unik (idempoten; on-chain juga menolak order ganda)
 */
export async function processNotification(n: MidtransNotification, source: 'webhook' | 'reconciler' | 'mock'): Promise<ProcessResult> {
  const orderId = String(n?.order_id ?? '');
  const sigOk = verifySignature(n);
  const done = async (ok: boolean, verdict: string, status?: string) => {
    await logWebhook(orderId || null, source, n, sigOk, verdict);
    return { ok, verdict, status };
  };
  if (!sigOk) return done(false, 'REJECTED: signature tidak valid');

  const order = await getOrder(orderId);
  if (!order) return done(false, 'REJECTED: order tidak dikenal');

  let verified: MidtransNotification | null;
  try { verified = await getStatus(orderId); }
  catch { return done(false, 'RETRY: Status API tidak dapat dihubungi, akan dicek ulang oleh reconciler', order.status); }
  if (!verified) return done(false, 'REJECTED: transaksi tidak ditemukan di payment gateway (webhook palsu?)', order.status);
  // Status API diambil langsung via HTTPS dengan Server Key (autentik oleh TLS); signature dicek bila disertakan.
  if (verified.signature_key && !verifySignature(verified)) return done(false, 'REJECTED: signature Status API tidak valid');
  if (verified.order_id && verified.order_id !== orderId) return done(false, 'REJECTED: order_id Status API berbeda');

  const verdict = classify(verified);
  await updateOrder(orderId, { gateway_status: verified.transaction_status });

  if (verdict === 'pending') return done(true, 'PENDING: pembayaran belum selesai', order.status);
  if (verdict === 'failed') {
    const to = verified.transaction_status === 'expire' ? 'EXPIRED' : verified.transaction_status === 'deny' ? 'DENIED' : 'CANCELLED';
    await transition(orderId, ['CREATED'], to);
    return done(true, `CLOSED: ${verified.transaction_status}`, to);
  }

  let paid: bigint;
  try { paid = parseGrossAmount(verified.gross_amount); } catch { return done(false, 'REJECTED: gross_amount tidak valid'); }
  if (paid !== BigInt(order.amount)) return done(false, `REJECTED: nominal ${paid} != order ${order.amount}`);

  const moved = await transition(orderId, ['CREATED', 'EXPIRED', 'CANCELLED'], 'QUEUED', { paid_at: new Date() });
  if (!moved) return done(true, `DUPLICATE: order sudah berstatus ${order.status}`, order.status);
  await enqueueOrder(orderId);
  return done(true, 'ACCEPTED: masuk antrean pencatatan on-chain', 'QUEUED');
}

/** Worker tunggal (concurrency 1) agar nonce transaksi oracle selalu berurutan. */
export function startWorker() {
  const worker = new Worker<ChainJob>('chain-tx', async (job: Job<ChainJob>) => {
    if (job.data.kind === 'record-order') return recordOrder(job.data.orderId, job.attemptsMade + 1);
    if (job.data.kind === 'confirm-redemption') return confirmRedemption(job.data.redemptionId, job.data.payoutRef);
  }, { connection: redis, concurrency: 1 });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(`[worker] job ${job.id} gagal (percobaan ${job.attemptsMade}${final ? ', final' : ''}): ${err.message}`);
    if (job.data.kind === 'record-order' && final) {
      await transition(job.data.orderId, ['QUEUED'], 'FAILED', { last_error: err.message });
    }
    if (job.data.kind === 'confirm-redemption' && final) {
      await pool.query(`UPDATE redemptions SET status='FAILED', last_error=$2, updated_at=now() WHERE id=$1`, [job.data.redemptionId, err.message]);
    }
  });
  worker.on('completed', job => console.log(`[worker] job ${job.id} selesai`));
  return worker;
}

async function recordOrder(orderId: string, attempt: number) {
  const order = await getOrder(orderId);
  if (!order) throw new UnrecoverableError('order hilang');
  if (order.status === 'RECORDED') return { skipped: true };
  await updateOrder(orderId, { attempts: attempt });

  const signer = await oracleSigner();
  const c = await contracts(signer);
  const key = orderHash(orderId);

  // Idempotensi on-chain: bila order sudah tercatat (mis. oracle crash setelah tx terkirim), cukup sinkronkan DB.
  if (await c.factory.usedOrders(key)) {
    const receiptId = order.type === 'donation' ? (await c.receipt.receiptOfOrder(key)).toString() : null;
    await transition(orderId, ['QUEUED', 'FAILED'], 'RECORDED', { receipt_id: receiptId, recorded_at: new Date() });
    return { alreadyRecorded: true };
  }

  try {
    const tx = order.type === 'donation'
      ? await c.campaign(order.campaign!).recordFiatDonation(key, order.donor_address, BigInt(order.amount))
      : await c.factory.topUp(key, order.donor_address, BigInt(order.amount));
    await updateOrder(orderId, { tx_hash: tx.hash });
    const rc = await tx.wait(config.confirmations, 60_000);
    if (!rc || rc.status !== 1) throw new Error('transaksi revert');
    let receiptId: string | null = null;
    for (const log of rc.logs) {
      try {
        const parsed = campaignIface.parseLog(log) ?? factoryIface.parseLog(log);
        if (parsed?.name === 'DonationRecorded') receiptId = parsed.args.receiptId.toString();
      } catch { /* log kontrak lain */ }
    }
    await transition(orderId, ['QUEUED', 'FAILED'], 'RECORDED',
      { tx_hash: rc.hash, receipt_id: receiptId, block_number: rc.blockNumber, recorded_at: new Date(), last_error: null });
    console.log(`[oracle] ${orderId} tercatat di block ${rc.blockNumber} (${rc.hash})`);
    return { txHash: rc.hash, receiptId };
  } catch (e) {
    const reason = decodeError(e);
    await updateOrder(orderId, { last_error: reason });
    if (reason === 'DuplicateOrder') { // sudah tercatat oleh percobaan sebelumnya
      await transition(orderId, ['QUEUED'], 'RECORDED', { recorded_at: new Date() });
      return { alreadyRecorded: true };
    }
    if (PERMANENT_ERRORS.has(reason)) throw new UnrecoverableError(reason);
    throw new Error(reason); // retry dengan backoff (RPC mati, timeout, nonce, dll.)
  }
}

async function confirmRedemption(redemptionId: string, payoutRef: string) {
  const signer = await oracleSigner();
  const { token } = await contracts(signer);
  const r = await token.redemptions(redemptionId);
  if (Number(r.status) === 2) {
    await pool.query(`UPDATE redemptions SET status='PAID', updated_at=now() WHERE id=$1`, [redemptionId]);
    return { already: true };
  }
  try {
    const tx = await token.confirmRedemption(redemptionId, payoutRef);
    const rc = await tx.wait(config.confirmations, 60_000);
    await pool.query(`UPDATE redemptions SET status='PAID', payout_ref=$2, confirm_tx=$3, updated_at=now() WHERE id=$1`,
      [redemptionId, payoutRef, rc.hash]);
    return { txHash: rc.hash };
  } catch (e) {
    const reason = decodeError(e);
    if (reason === 'InvalidRedemption') throw new UnrecoverableError(reason);
    throw new Error(reason);
  }
}
