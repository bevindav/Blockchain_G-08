import fs from 'node:fs';
import path from 'node:path';

const env = (name: string, fallback?: string) => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing env ${name}`);
    return fallback;
  }
  return v;
};

// Private key akun development Hardhat (publik, HANYA untuk private chain lokal).
const DEV_ORACLE_KEY = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'; // akun #3
const DEV_FAUCET_KEY = '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6'; // akun #9

const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
const mode = (process.env.MIDTRANS_MODE || (serverKey ? 'sandbox' : 'mock')) as 'mock' | 'sandbox' | 'production';

export const config = {
  port: Number(env('PORT', '4000')),
  rpcUrls: env('RPC_URLS', 'http://127.0.0.1:8545,http://127.0.0.1:8546').split(',').map(s => s.trim()).filter(Boolean),
  publicRpcUrl: env('PUBLIC_RPC_URL', 'http://127.0.0.1:8545'),
  databaseUrl: env('DATABASE_URL', 'postgres://donasi:donasi@127.0.0.1:5432/donasi'),
  redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
  ipfsApiUrl: env('IPFS_API_URL', 'http://127.0.0.1:5001'),
  pinataJwt: process.env.PINATA_JWT || '',
  publicIpfsGateway: env('PUBLIC_IPFS_GATEWAY', 'http://127.0.0.1:8080/ipfs/'),
  deploymentsFile: env('DEPLOYMENTS_FILE', path.join(__dirname, '../../smart-contract/deployments/besu.json')),
  oracleKey: env('ORACLE_PRIVATE_KEY', DEV_ORACLE_KEY),
  faucetKey: env('FAUCET_PRIVATE_KEY', DEV_FAUCET_KEY),
  custodyAddress: env('CUSTODY_ADDRESS', '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720'),
  frontendUrl: env('FRONTEND_URL', 'http://localhost:3000'),
  confirmations: Number(env('CONFIRMATIONS', '1')),
  reconcileIntervalMs: Number(env('RECONCILE_INTERVAL_MS', '20000')),
  orderTtlMinutes: Number(env('ORDER_TTL_MINUTES', '60')),
  minAmount: Number(env('MIN_DONATION', '1000')),
  maxAmount: Number(env('MAX_DONATION', '100000000')),
  midtrans: {
    mode,
    serverKey: serverKey || 'MOCK-SERVER-KEY-donasi-transparan',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
    snapUrl: mode === 'production' ? 'https://app.midtrans.com/snap/v1/transactions' : 'https://app.sandbox.midtrans.com/snap/v1/transactions',
    apiUrl: mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com',
    snapJs: mode === 'production' ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js',
  },
};

export type Deployment = {
  chainId: number; startBlock: number; token: string; factory: string; receipt: string; implementation: string;
  admin: string; ngo: string; verifier: string; oracle: string; approvers: string[]; threshold: number; fiatCap: string;
};

let cached: Deployment | null = null;
let cachedMtime = 0;

/** Membaca alamat kontrak hasil deploy (otomatis reload bila file berubah, mis. setelah redeploy). */
export function deployment(): Deployment {
  const stat = fs.statSync(config.deploymentsFile);
  if (!cached || stat.mtimeMs !== cachedMtime) {
    cached = JSON.parse(fs.readFileSync(config.deploymentsFile, 'utf8')) as Deployment;
    cachedMtime = stat.mtimeMs;
  }
  return cached;
}
