import { config } from './config';
import { pool, transition, Order } from './db';
import { getStatus } from './midtrans';
import { processNotification, enqueueOrder, chainQueue } from './oracle';
import { contracts, orderHash } from './chain';

/**
 * Rekonsiliasi berkala (fallback bila webhook tidak sampai, mis. ngrok mati):
 *  1. Order CREATED -> tanya Status API Midtrans; bila settlement, proses seperti webhook.
 *  2. Order QUEUED tanpa job aktif -> masukkan ulang ke antrean.
 *  3. Order CREATED yang melewati TTL -> EXPIRED.
 */
export function startReconciler() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await reconcile(); } catch (e) { console.error('[reconciler]', (e as Error).message); }
    finally { running = false; }
  }, config.reconcileIntervalMs);
}

export async function reconcile() {
  const { rows: pending } = await pool.query<Order>(
    `SELECT * FROM orders WHERE status='CREATED' AND created_at < now() - interval '15 seconds' ORDER BY created_at LIMIT 50`);
  for (const o of pending) {
    const status = await getStatus(o.order_id).catch(() => null);
    if (status) await processNotification(status, 'reconciler');
    else if (Date.now() - new Date(o.created_at).getTime() > config.orderTtlMinutes * 60_000)
      await transition(o.order_id, ['CREATED'], 'EXPIRED');
  }

  const { rows: queued } = await pool.query<Order>(
    `SELECT * FROM orders WHERE status='QUEUED' AND updated_at < now() - interval '60 seconds' LIMIT 50`);
  for (const o of queued) {
    const job = await chainQueue.getJob(`order-${o.order_id}`);
    const state = job ? await job.getState() : 'missing';
    if (state === 'missing' || state === 'failed' || state === 'completed') {
      console.warn(`[reconciler] order ${o.order_id} QUEUED tanpa job aktif (${state}), dimasukkan ulang`);
      await enqueueOrder(o.order_id);
    }
  }
}

/** Laporan konsistensi DB <-> blockchain (ditampilkan di dashboard admin). */
export async function consistencyReport() {
  const { rows: counts } = await pool.query(`SELECT status, count(*)::int AS n, coalesce(sum(amount),0)::text AS total FROM orders GROUP BY status`);
  const { rows: recorded } = await pool.query<Order>(`SELECT * FROM orders WHERE status='RECORDED' ORDER BY recorded_at DESC LIMIT 200`);
  const { factory } = await contracts();
  const mismatches: string[] = [];
  for (const o of recorded) if (!(await factory.usedOrders(orderHash(o.order_id)))) mismatches.push(o.order_id);
  return { counts, checked: recorded.length, mismatches };
}
