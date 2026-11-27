import { id } from 'ethers';
import { deployment } from './config';
import { getProvider, tokenIface, campaignIface, factoryIface } from './chain';
import { kvGet, kvSet, pool } from './db';
import { chainQueue } from './oracle';

const CHUNK = 2000;
const topic = (iface: typeof tokenIface, name: string) => iface.getEvent(name)!.topicHash;

/**
 * Event listener (polling getLogs, tahan restart karena posisi blok disimpan di DB):
 *  - RedemptionRequested  -> off-ramp: simulasi transfer bank lalu konfirmasi on-chain (RedemptionPaid)
 *  - DonationRecorded / TopUpRecorded -> rekonsiliasi status order di DB dengan data on-chain
 */
export function startListener() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await poll(); } catch (e) { console.error('[listener]', (e as Error).message); }
    finally { running = false; }
  };
  setInterval(tick, 4000);
  tick();
}

async function poll() {
  const d = deployment();
  const provider = await getProvider();
  const key = `listener:${d.factory.toLowerCase()}`;
  const from = Number((await kvGet(key)) ?? d.startBlock ?? 0);
  const latest = await provider.getBlockNumber();
  if (from > latest) return;
  const to = Math.min(latest, from + CHUNK);

  const [redemptions, donations, topups] = await Promise.all([
    provider.getLogs({ address: d.token, topics: [topic(tokenIface, 'RedemptionRequested')], fromBlock: from, toBlock: to }),
    provider.getLogs({ topics: [topic(campaignIface, 'DonationRecorded')], fromBlock: from, toBlock: to }),
    provider.getLogs({ address: d.factory, topics: [topic(factoryIface, 'TopUpRecorded')], fromBlock: from, toBlock: to }),
  ]);

  for (const log of redemptions) {
    const ev = tokenIface.parseLog(log)!;
    const rid = ev.args.id.toString();
    const inserted = await pool.query(
      `INSERT INTO redemptions(id, account, amount, bank_ref, status, request_tx) VALUES ($1,$2,$3,$4,'PROCESSING',$5)
       ON CONFLICT (id) DO NOTHING`, [rid, ev.args.account, ev.args.amount.toString(), ev.args.bankRef, log.transactionHash]);
    if (!inserted.rowCount) continue;
    const intent = await pool.query('SELECT * FROM redemption_intents WHERE bank_ref = $1', [ev.args.bankRef]);
    const bank = intent.rows[0];
    // Simulasi payout bank (mis. Midtrans Iris / transfer manual bendahara). Data rekening tetap off-chain.
    const payoutRef = id(`PAYOUT-${rid}-${Date.now()}`);
    console.log(`[off-ramp] transfer Rp${ev.args.amount} ke ${bank ? `${bank.bank_name} ${bank.account_masked} a.n. ${bank.account_name}` : 'rekening tidak dikenal'} (redemption #${rid})`);
    await chainQueue.add('confirm-redemption', { kind: 'confirm-redemption', redemptionId: rid, payoutRef }, { jobId: `redeem-${rid}` });
  }

  for (const log of donations) {
    const ev = campaignIface.parseLog(log)!;
    if (ev.args.orderId === '0x' + '0'.repeat(64)) continue;
    await syncOrder(ev.args.orderId, log.transactionHash, log.blockNumber, ev.args.receiptId.toString());
  }
  for (const log of topups) {
    const ev = factoryIface.parseLog(log)!;
    await syncOrder(ev.args.orderId, log.transactionHash, log.blockNumber, null);
  }
  await kvSet(key, String(to + 1));
}

async function syncOrder(hash: string, txHash: string, block: number, receiptId: string | null) {
  const { rowCount } = await pool.query(
    `UPDATE orders SET status='RECORDED', tx_hash=$2, block_number=$3, receipt_id=COALESCE($4, receipt_id),
       recorded_at=COALESCE(recorded_at, now()), updated_at=now()
     WHERE order_hash=$1 AND status <> 'RECORDED'`, [hash, txHash, block, receiptId]);
  if (rowCount) console.log(`[listener] order ${hash.slice(0, 10)} disinkronkan dari event on-chain`);
}

