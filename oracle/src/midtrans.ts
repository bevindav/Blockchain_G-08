import crypto from 'node:crypto';
import { config } from './config';

/** Payload notifikasi HTTP Midtrans (subset field yang dipakai). */
export type MidtransNotification = {
  order_id: string;
  transaction_status: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  fraud_status?: string;
  payment_type?: string;
  transaction_id?: string;
  transaction_time?: string;
};

export type Verdict = 'success' | 'pending' | 'failed';

/** signature_key = SHA512(order_id + status_code + gross_amount + ServerKey) */
export function computeSignature(orderId: string, statusCode: string, grossAmount: string, serverKey = config.midtrans.serverKey) {
  return crypto.createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');
}

export function verifySignature(n: Pick<MidtransNotification, 'order_id' | 'status_code' | 'gross_amount' | 'signature_key'>, serverKey = config.midtrans.serverKey) {
  if (!n?.signature_key || typeof n.signature_key !== 'string') return false;
  const expected = Buffer.from(computeSignature(n.order_id, n.status_code, n.gross_amount, serverKey), 'hex');
  const given = Buffer.from(n.signature_key, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Pemetaan status Midtrans -> keputusan oracle (lihat dokumentasi "Transaction Status" Midtrans). */
export function classify(n: Pick<MidtransNotification, 'transaction_status' | 'fraud_status'>): Verdict {
  const s = n.transaction_status;
  if (s === 'settlement') return 'success';
  if (s === 'capture') return n.fraud_status === 'accept' || !n.fraud_status ? 'success' : 'pending';
  if (s === 'pending' || s === 'authorize') return 'pending';
  return 'failed'; // deny, cancel, expire, failure, refund, chargeback
}

/** "100000.00" -> 100000n, menolak pecahan sen karena 1 dIDR = Rp1. */
export function parseGrossAmount(gross: string): bigint {
  if (!/^\d+(\.00?)?$/.test(gross)) throw new Error(`gross_amount tidak valid: ${gross}`);
  return BigInt(gross.split('.')[0]);
}

const authHeader = () => 'Basic ' + Buffer.from(config.midtrans.serverKey + ':').toString('base64');

async function fetchJson(url: string, init: RequestInit, attempts = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 500) throw new Error(`Midtrans ${res.status}`);
      return { status: res.status, body };
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * 2 ** i)); // retry dengan exponential backoff
    }
  }
  throw lastErr;
}

/** Membuat transaksi Snap. Mengembalikan token untuk popup Snap.js dan redirect_url. */
export async function createSnap(params: { orderId: string; amount: bigint; name: string; email?: string | null; itemName: string }) {
  if (config.midtrans.mode === 'mock') {
    return { token: `mock-${params.orderId}`, redirect_url: `${config.frontendUrl}/pay/mock/${encodeURIComponent(params.orderId)}` };
  }
  const { status, body } = await fetchJson(config.midtrans.snapUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      transaction_details: { order_id: params.orderId, gross_amount: Number(params.amount) },
      item_details: [{ id: 'donation', price: Number(params.amount), quantity: 1, name: params.itemName.slice(0, 50) }],
      customer_details: { first_name: params.name.slice(0, 50), email: params.email || undefined },
      callbacks: { finish: `${config.frontendUrl}/payment/${encodeURIComponent(params.orderId)}` },
      expiry: { unit: 'minutes', duration: config.orderTtlMinutes },
    }),
  });
  if (status !== 201 || !body.token) throw new Error(`Snap error ${status}: ${JSON.stringify(body.error_messages || body)}`);
  return body as { token: string; redirect_url: string };
}

/**
 * Sumber kebenaran kedua: Status API Midtrans. Oracle TIDAK mempercayai isi webhook begitu saja,
 * tetapi menanyakan ulang status transaksi langsung ke Midtrans (mitigasi spoofed/replayed webhook).
 */
export async function getStatus(orderId: string): Promise<MidtransNotification | null> {
  if (config.midtrans.mode === 'mock') return mockGateway.get(orderId) ?? null;
  const { status, body } = await fetchJson(`${config.midtrans.apiUrl}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: 'application/json', Authorization: authHeader() },
  });
  if (status === 404 || body.status_code === '404') return null;
  return body as MidtransNotification;
}

/**
 * Simulator payment gateway untuk mode mock (tanpa akun Midtrans): menyimpan status transaksi
 * dan menghasilkan notifikasi bertanda tangan persis seperti Midtrans sehingga jalur verifikasi tetap sama.
 */
export const mockGateway = new Map<string, MidtransNotification>();

export function mockSettle(orderId: string, amount: bigint, outcome: 'settlement' | 'deny' | 'expire'): MidtransNotification {
  const status_code = outcome === 'settlement' ? '200' : '202';
  const gross_amount = `${amount}.00`;
  const n: MidtransNotification = {
    order_id: orderId, transaction_status: outcome, status_code, gross_amount, payment_type: 'qris',
    fraud_status: 'accept', transaction_id: crypto.randomUUID(), transaction_time: new Date().toISOString(),
    signature_key: computeSignature(orderId, status_code, gross_amount),
  };
  mockGateway.set(orderId, n);
  return n;
}
