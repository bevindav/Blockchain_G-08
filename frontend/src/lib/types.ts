export type AppConfig = {
  chainId: number;
  rpcUrl: string;
  startBlock: number;
  contracts: { token: string; factory: string; receipt: string; implementation: string };
  roles: { admin: string; ngo: string; verifier: string; oracle: string; approvers: string[]; threshold: number };
  fiatCap: string;
  custodyAddress: string;
  ipfsGateway: string;
  payment: { mode: 'mock' | 'sandbox' | 'production'; clientKey: string; snapJs: string; minAmount: number; maxAmount: number };
};

export type CampaignMeta = {
  title: string;
  description?: string;
  category?: string;
  organizer?: string;
  image?: string;
  milestones?: { title: string; plan?: string }[];
};

export const CAMPAIGN_STATES = ['Menunggu Verifikasi', 'Aktif', 'Selesai', 'Dibatalkan'] as const;
export const WITHDRAWAL_STATES = ['Menunggu Persetujuan', 'Disetujui', 'Dicairkan', 'Ditolak', 'Dibatalkan'] as const;

export type Milestone = { budget: bigint; paid: bigint; reserved: bigint };
export type Withdrawal = {
  id: number; amount: bigint; milestone: number; approvals: number; rejections: number; status: number;
  requestedAt: number; proofHash: string; proofCID?: string;
};
export type Summary = {
  ngo: string; recipient: string; state: number; deadline: number; threshold: number; approverCount: number;
  totalBudget: bigint; totalDonated: bigint; totalPaid: bigint; reserved: bigint; balance: bigint;
  donationCount: number; milestoneCount: number; withdrawalCount: number; metadataCID: string;
};
export type CampaignData = {
  address: string; summary: Summary; milestones: Milestone[]; withdrawals: Withdrawal[]; approvers: string[];
  meta: CampaignMeta;
};

export type Order = {
  orderId: string; orderHash: string; type: 'donation' | 'topup'; campaign: string | null; donorAddress: string;
  donorName: string | null; amount: string; status: string; gatewayStatus: string | null; redirectUrl: string | null;
  snapToken?: string | null; txHash: string | null; receiptId: string | null; blockNumber: string | null;
  attempts: number; lastError: string | null; createdAt: string; paidAt: string | null; recordedAt: string | null;
};
