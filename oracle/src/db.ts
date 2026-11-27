import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type OrderStatus =
  | 'CREATED'   // order dibuat, menunggu pembayaran
  | 'PAID'      // pembayaran terverifikasi (signature + Status API + nominal)
  | 'QUEUED'    // menunggu dicatat on-chain oleh worker
  | 'RECORDED'  // tercatat on-chain
  | 'FAILED'    // gagal permanen dicatat (perlu refund rupiah manual)
  | 'EXPIRED' | 'CANCELLED' | 'DENIED';

export type Order = {
  order_id: string; order_hash: string; type: 'donation' | 'topup'; campaign: string | null; donor_address: string;
  donor_name: string | null; donor_email: string | null; amount: string; status: OrderStatus;
  gateway_status: string | null; snap_token: string | null; redirect_url: string | null;
  tx_hash: string | null; receipt_id: string | null; block_number: string | null; attempts: number;
  last_error: string | null; created_at: Date; updated_at: Date; paid_at: Date | null; recorded_at: Date | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  order_id      TEXT PRIMARY KEY,
  order_hash    TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK (type IN ('donation','topup')),
  campaign      TEXT,
  donor_address TEXT NOT NULL,
  donor_name    TEXT,
  donor_email   TEXT,
  amount        BIGINT NOT NULL CHECK (amount > 0),
  status        TEXT NOT NULL,
  gateway_status TEXT,
  snap_token    TEXT,
  redirect_url  TEXT,
  tx_hash       TEXT,
  receipt_id    TEXT,
  block_number  BIGINT,
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ,
  recorded_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_donor_idx ON orders(lower(donor_address));
CREATE INDEX IF NOT EXISTS orders_campaign_idx ON orders(lower(campaign));

CREATE TABLE IF NOT EXISTS webhook_logs (
  id              SERIAL PRIMARY KEY,
  order_id        TEXT,
  source          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  signature_valid BOOLEAN,
  verdict         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_intents (
  bank_ref        TEXT PRIMARY KEY,
  account         TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  account_masked  TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemptions (
  id          BIGINT PRIMARY KEY,
  account     TEXT NOT NULL,
  amount      BIGINT NOT NULL,
  bank_ref    TEXT NOT NULL,
  status      TEXT NOT NULL,
  payout_ref  TEXT,
  request_tx  TEXT,
  confirm_tx  TEXT,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export async function migrate(retries = 30) {
  for (let i = 0; ; i++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const { rows } = await pool.query<Order>('SELECT * FROM orders WHERE order_id = $1', [orderId]);
  return rows[0] ?? null;
}

export async function updateOrder(orderId: string, fields: Partial<Record<keyof Order, unknown>>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE orders SET ${sets}, updated_at = now() WHERE order_id = $1`, [orderId, ...keys.map(k => (fields as any)[k])]);
}

/** Transisi status atomik: hanya berhasil bila status saat ini termasuk `from` (mencegah race webhook ganda). */
export async function transition(orderId: string, from: OrderStatus[], to: OrderStatus, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  const sets = keys.map((k, i) => `, ${k} = $${i + 4}`).join('');
  const { rowCount } = await pool.query(
    `UPDATE orders SET status = $2, updated_at = now()${sets} WHERE order_id = $1 AND status = ANY($3)`,
    [orderId, to, from, ...keys.map(k => extra[k])]);
  return (rowCount ?? 0) > 0;
}

export async function logWebhook(orderId: string | null, source: string, payload: unknown, signatureValid: boolean | null, verdict: string) {
  await pool.query('INSERT INTO webhook_logs(order_id, source, payload, signature_valid, verdict) VALUES ($1,$2,$3,$4,$5)',
    [orderId, source, JSON.stringify(payload), signatureValid, verdict]);
}

export async function kvGet(key: string) {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM kv WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function kvSet(key: string, value: string) {
  await pool.query('INSERT INTO kv(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}
