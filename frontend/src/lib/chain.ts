import { Contract, Interface, JsonRpcProvider, Log } from 'ethers';
import CampaignAbi from './abi/Campaign.json';
import FactoryAbi from './abi/CampaignFactory.json';
import TokenAbi from './abi/DonationToken.json';
import ReceiptAbi from './abi/DonationReceipt.json';
import type { AppConfig } from './types';

export const ABI = { Campaign: CampaignAbi, Factory: FactoryAbi, Token: TokenAbi, Receipt: ReceiptAbi };
export const ifaces = {
  campaign: new Interface(CampaignAbi), factory: new Interface(FactoryAbi),
  token: new Interface(TokenAbi), receipt: new Interface(ReceiptAbi),
};

let provider: JsonRpcProvider | null = null;

/** Provider read-only (RPC publik node validator) - siapa pun bisa membaca data tanpa wallet. */
export function readProvider(cfg: AppConfig) {
  if (!provider) provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true });
  return provider;
}

export function contracts(cfg: AppConfig) {
  const p = readProvider(cfg);
  return {
    factory: new Contract(cfg.contracts.factory, FactoryAbi, p),
    token: new Contract(cfg.contracts.token, TokenAbi, p),
    receipt: new Contract(cfg.contracts.receipt, ReceiptAbi, p),
    campaign: (a: string) => new Contract(a, CampaignAbi, p),
  };
}

const ERROR_TEXT: Record<string, string> = {
  Unauthorized: 'Akun Anda tidak memiliki hak untuk aksi ini',
  AccessControlUnauthorizedAccount: 'Akun Anda tidak memiliki role yang dibutuhkan',
  InvalidState: 'Status campaign/pengajuan tidak memungkinkan aksi ini',
  DeadlinePassed: 'Campaign sudah melewati deadline',
  InvalidDeadline: 'Deadline harus di masa depan',
  InvalidDonation: 'Nominal donasi tidak valid',
  ExceedsTarget: 'Donasi melebihi sisa target dana',
  ExceedsFiatCap: 'Melebihi batas transaksi fiat',
  InvalidWithdrawal: 'Pengajuan pencairan tidak valid',
  ExceedsMilestone: 'Nominal melebihi sisa anggaran milestone',
  InsufficientEscrow: 'Saldo escrow belum mencukupi',
  AlreadyVoted: 'Anda sudah memberikan suara untuk pengajuan ini',
  InvalidProof: 'Bukti wajib diunggah',
  DuplicateProof: 'Bukti ini sudah pernah dipakai (duplikat ditolak)',
  DuplicateOrder: 'Order pembayaran sudah pernah dicatat',
  RecipientNotRegistered: 'Wallet penerima belum terdaftar/diverifikasi',
  NothingToRefund: 'Tidak ada dana yang dapat di-refund',
  NoMilestones: 'Minimal satu milestone',
  ZeroBudget: 'Anggaran milestone tidak boleh nol',
  ERC20InsufficientBalance: 'Saldo dIDR tidak cukup',
  ERC20InsufficientAllowance: 'Allowance dIDR belum cukup',
  EnforcedPause: 'Sistem sedang di-pause oleh admin',
  InvalidRedemption: 'Penukaran tidak valid',
  ZeroAmount: 'Nominal tidak boleh nol',
  InvalidThreshold: 'Threshold tidak valid',
  InvalidApprover: 'Daftar approver tidak valid',
};

function findRevertData(e: any): string | undefined {
  const seen = new Set();
  const stack = [e];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    if (typeof cur.data === 'string' && cur.data.startsWith('0x') && cur.data.length >= 10) return cur.data;
    for (const k of ['error', 'info', 'cause', 'data']) if (cur[k] && typeof cur[k] === 'object') stack.push(cur[k]);
  }
}

/** Revert custom error -> pesan berbahasa Indonesia. */
export function explainError(e: any): string {
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001 || e?.info?.error?.code === 4001) return 'Transaksi dibatalkan di MetaMask';
  const data = findRevertData(e);
  if (data) {
    for (const iface of Object.values(ifaces)) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) return ERROR_TEXT[parsed.name] ? `${ERROR_TEXT[parsed.name]} (${parsed.name})` : parsed.name;
      } catch { /* lanjut */ }
    }
  }
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

/** Decode log dengan semua ABI kontrak platform (dipakai explorer & timeline). */
export function decodeLog(log: Log | { topics: readonly string[]; data: string }) {
  for (const [name, iface] of Object.entries(ifaces)) {
    try {
      const parsed = iface.parseLog(log as any);
      if (parsed) return { contract: name, parsed };
    } catch { /* lanjut */ }
  }
  return null;
}

const blockTimes = new Map<number, number>();
export async function blockTime(cfg: AppConfig, n: number) {
  if (!blockTimes.has(n)) {
    const b = await readProvider(cfg).getBlock(n);
    blockTimes.set(n, b?.timestamp ?? 0);
  }
  return blockTimes.get(n)!;
}
