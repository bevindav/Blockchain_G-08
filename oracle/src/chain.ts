import { Contract, Interface, JsonRpcProvider, Wallet, id } from 'ethers';
import { config, deployment } from './config';
import CampaignAbi from './abi/Campaign.json';
import FactoryAbi from './abi/CampaignFactory.json';
import TokenAbi from './abi/DonationToken.json';
import ReceiptAbi from './abi/DonationReceipt.json';

export const abis = { Campaign: CampaignAbi, CampaignFactory: FactoryAbi, DonationToken: TokenAbi, DonationReceipt: ReceiptAbi };
export const campaignIface = new Interface(CampaignAbi);
export const factoryIface = new Interface(FactoryAbi);
export const tokenIface = new Interface(TokenAbi);

/** Hash order id Midtrans -> bytes32 yang dicatat on-chain. */
export const orderHash = (orderId: string) => id(orderId);

const providers = config.rpcUrls.map(url => ({ url, provider: new JsonRpcProvider(url, undefined, { staticNetwork: true, polling: true, pollingInterval: 1000 }) }));
let current = 0;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t!));
}

/**
 * Fallback RPC: memakai node yang terakhir sehat; bila gagal merespons dalam 3 detik,
 * pindah ke node validator berikutnya. Menjaga oracle tetap berjalan saat satu node mati.
 */
export async function getProvider(): Promise<JsonRpcProvider> {
  for (let i = 0; i < providers.length; i++) {
    const idx = (current + i) % providers.length;
    try {
      await withTimeout(providers[idx].provider.getBlockNumber(), 3000);
      if (idx !== current) console.warn(`[rpc] failover ke ${providers[idx].url}`);
      current = idx;
      return providers[idx].provider;
    } catch { /* coba node berikutnya */ }
  }
  throw new Error('Semua RPC node tidak dapat dihubungi');
}

export async function rpcHealth() {
  return Promise.all(providers.map(async ({ url, provider }) => {
    try { return { url, ok: true, block: await withTimeout(provider.getBlockNumber(), 3000) }; }
    catch (e) { return { url, ok: false, error: (e as Error).message }; }
  }));
}

export async function oracleSigner() { return new Wallet(config.oracleKey, await getProvider()); }
export async function faucetSigner() { return new Wallet(config.faucetKey, await getProvider()); }

export async function contracts(runner?: Wallet) {
  const d = deployment();
  const r = runner ?? await getProvider();
  return {
    factory: new Contract(d.factory, FactoryAbi, r),
    token: new Contract(d.token, TokenAbi, r),
    receipt: new Contract(d.receipt, ReceiptAbi, r),
    campaign: (address: string) => new Contract(address, CampaignAbi, r),
  };
}

/** Mengubah revert custom error menjadi nama error yang mudah dibaca. */
export function decodeError(e: any): string {
  const data: string | undefined = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    for (const iface of [campaignIface, factoryIface, tokenIface]) {
      try { const parsed = iface.parseError(data); if (parsed) return parsed.name; } catch { /* lanjut */ }
    }
  }
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

/** Error bisnis yang tidak akan berhasil walau dicoba ulang. */
export const PERMANENT_ERRORS = new Set(['InvalidState', 'DeadlinePassed', 'ExceedsTarget', 'ExceedsFiatCap',
  'InvalidDonation', 'Unauthorized', 'AccessControlUnauthorizedAccount', 'OnlyCampaign']);
