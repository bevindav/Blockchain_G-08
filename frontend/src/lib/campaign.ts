import { ZeroHash } from 'ethers';
import { contracts, ifaces, readProvider, blockTime } from './chain';
import { fetchMetadata } from './ipfs';
import type { AppConfig, CampaignData, Milestone, Summary, Withdrawal } from './types';

function toSummary(s: any): Summary {
  return {
    ngo: s.ngo, recipient: s.recipient, state: Number(s.state), deadline: Number(s.deadline),
    threshold: Number(s.threshold), approverCount: Number(s.approverCount), totalBudget: s.totalBudget,
    totalDonated: s.totalDonated, totalPaid: s.totalPaid, reserved: s.reserved, balance: s.balance,
    donationCount: Number(s.donationCount), milestoneCount: Number(s.milestoneCount),
    withdrawalCount: Number(s.withdrawalCount), metadataCID: s.metadataCID,
  };
}

export async function loadCampaign(cfg: AppConfig, address: string): Promise<CampaignData> {
  const c = contracts(cfg).campaign(address);
  const [s, ms, ws, approvers] = await Promise.all([c.summary(), c.getMilestones(), c.getWithdrawals(), c.getApprovers()]);
  const summary = toSummary(s);
  const withdrawals: Withdrawal[] = ws.map((w: any, i: number) => ({
    id: i, amount: w.amount, milestone: Number(w.milestone), approvals: Number(w.approvals), rejections: Number(w.rejections),
    status: Number(w.status), requestedAt: Number(w.requestedAt), proofHash: w.proofHash,
  }));
  // CID bukti hanya disimpan di event (hemat gas), jadi diambil dari log WithdrawalRequested
  if (withdrawals.length) {
    const logs = await readProvider(cfg).getLogs({ address, topics: [ifaces.campaign.getEvent('WithdrawalRequested')!.topicHash], fromBlock: cfg.startBlock });
    for (const l of logs) {
      const ev = ifaces.campaign.parseLog(l)!;
      const w = withdrawals[Number(ev.args.id)];
      if (w) w.proofCID = ev.args.proofCID;
    }
  }
  return {
    address, summary, approvers: [...approvers], withdrawals,
    milestones: ms.map((m: any): Milestone => ({ budget: m.budget, paid: m.paid, reserved: m.reserved })),
    meta: await fetchMetadata(summary.metadataCID),
  };
}

export async function loadAllCampaigns(cfg: AppConfig) {
  const list: string[] = await contracts(cfg).factory.getCampaigns();
  const data = await Promise.all([...list].reverse().map(a => loadCampaign(cfg, a).catch(() => null)));
  return data.filter(Boolean) as CampaignData[];
}

export type TimelineItem = {
  key: string; kind: string; block: number; order: number; time: number; txHash: string; args: Record<string, any>;
};

/**
 * Jejak dana end-to-end dari log blockchain:
 * dibuat -> diverifikasi -> donasi -> pengajuan (bukti) -> persetujuan -> pencairan ke penerima
 * -> laporan penyaluran -> penerima menukar dIDR ke rupiah (off-ramp).
 */
export async function loadTimeline(cfg: AppConfig, address: string, recipient: string): Promise<TimelineItem[]> {
  const p = readProvider(cfg);
  const fromBlock = cfg.startBlock;
  const createdTopic = ifaces.factory.getEvent('CampaignCreated')!.topicHash;
  const pad = (a: string) => '0x' + a.toLowerCase().replace('0x', '').padStart(64, '0');
  const redeemTopic = ifaces.token.getEvent('RedemptionRequested')!.topicHash;
  const paidTopic = ifaces.token.getEvent('RedemptionPaid')!.topicHash;
  const [own, created, redeemed, paid] = await Promise.all([
    p.getLogs({ address, fromBlock }),
    p.getLogs({ address: cfg.contracts.factory, topics: [createdTopic, pad(address)], fromBlock }),
    p.getLogs({ address: cfg.contracts.token, topics: [redeemTopic, null, pad(recipient)], fromBlock }),
    p.getLogs({ address: cfg.contracts.token, topics: [paidTopic, null, pad(recipient)], fromBlock }),
  ]);
  const items: TimelineItem[] = [];
  const push = async (l: any, iface: typeof ifaces.campaign) => {
    let ev; try { ev = iface.parseLog(l); } catch { return; }
    if (!ev) return;
    const args: Record<string, any> = {};
    ev.fragment.inputs.forEach((inp, i) => { args[inp.name] = ev!.args[i]; });
    items.push({ key: `${l.transactionHash}-${l.index}`, kind: ev.name, block: l.blockNumber, order: l.transactionIndex * 10000 + l.index, time: await blockTime(cfg, l.blockNumber), txHash: l.transactionHash, args });
  };
  await Promise.all([
    ...created.map(l => push(l, ifaces.factory)),
    ...own.map(l => push(l, ifaces.campaign)),
    ...redeemed.map(l => push(l, ifaces.token)),
    ...paid.map(l => push(l, ifaces.token)),
  ]);
  return items.sort((a, b) => a.block - b.block || a.order - b.order);
}

export const isFiat = (orderId: string) => orderId && orderId !== ZeroHash;
