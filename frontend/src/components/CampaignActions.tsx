'use client';

import { useEffect, useState } from 'react';
import { ABI, contracts } from '@/lib/chain';
import type { UploadResult } from '@/lib/api';
import { rupiah, sameAddr, dateTime } from '@/lib/format';
import { useConfig, useTx, useWallet } from '@/lib/providers';
import type { CampaignData } from '@/lib/types';
import { FileUpload, ProofLink } from './Proof';
import { Empty, Notice, WithdrawalBadge } from './ui';

type Props = { c: CampaignData; reload: () => void };

/** Daftar pengajuan pencairan dengan aksi sesuai role (approve/reject/execute/cancel/laporan). */
export function Withdrawals({ c, reload }: Props) {
  const cfg = useConfig();
  const { account } = useWallet();
  const { send } = useTx();
  const [votes, setVotes] = useState<Record<number, number>>({});
  const [report, setReport] = useState<Record<number, UploadResult | null>>({});
  const target = { address: c.address, abi: ABI.Campaign };
  const isNgo = sameAddr(account, c.summary.ngo);
  const isRecipient = sameAddr(account, c.summary.recipient);
  const isApprover = c.approvers.some(a => sameAddr(a, account));
  const active = c.summary.state === 1;

  useEffect(() => {
    if (!account || !isApprover) return;
    const camp = contracts(cfg).campaign(c.address);
    Promise.all(c.withdrawals.map(w => camp.votes(w.id, account))).then(v =>
      setVotes(Object.fromEntries(v.map((x, i) => [i, Number(x)]))));
  }, [account, isApprover, c, cfg]);

  const act = async (label: string, method: string, args: unknown[]) => { if (await send(label, target, method, args)) reload(); };

  if (!c.withdrawals.length) return <Empty>Belum ada pengajuan pencairan.</Empty>;
  return (
    <div className="space-y-3">
      {[...c.withdrawals].reverse().map(w => {
        const m = c.meta.milestones?.[w.milestone];
        return (
          <div key={w.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">#{w.id} · Milestone {w.milestone + 1}{m ? `: ${m.title}` : ''}</div>
              <WithdrawalBadge status={w.status} />
            </div>
            <div className="mt-1 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <div>Nominal: <b className="text-slate-900">{rupiah(w.amount)}</b></div>
              <div>Diajukan: {dateTime(w.requestedAt)}</div>
              <div>Persetujuan: <b>{w.approvals}</b> / {c.summary.threshold} dibutuhkan (dari {c.summary.approverCount} approver) · tolak {w.rejections}</div>
              <div>Bukti: <ProofLink cid={w.proofCID} hash={w.proofHash} /></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {active && isApprover && w.status === 0 && !votes[w.id] && (
                <>
                  <button className="btn-primary btn-sm" onClick={() => act(`Setujui pencairan #${w.id}`, 'approveWithdrawal', [w.id])}>Setujui</button>
                  <button className="btn-danger btn-sm" onClick={() => {
                    const reason = prompt('Alasan penolakan (tercatat on-chain):');
                    if (reason) act(`Tolak pencairan #${w.id}`, 'rejectWithdrawal', [w.id, reason]);
                  }}>Tolak</button>
                </>
              )}
              {isApprover && votes[w.id] ? <span className="text-xs text-slate-500">Anda sudah {votes[w.id] === 1 ? 'menyetujui' : 'menolak'}</span> : null}
              {active && w.status === 1 && (isNgo || isApprover) && (
                <button className="btn-primary btn-sm" onClick={() => act(`Eksekusi pencairan #${w.id}`, 'executeWithdrawal', [w.id])}>Eksekusi pencairan ke penerima</button>
              )}
              {isNgo && (w.status === 0 || w.status === 1) && (
                <button className="btn-secondary btn-sm" onClick={() => act(`Batalkan pengajuan #${w.id}`, 'cancelWithdrawal', [w.id])}>Batalkan pengajuan</button>
              )}
            </div>
            {w.status === 2 && (isNgo || isRecipient) && (
              <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                <FileUpload label="Unggah laporan / bukti penyaluran" value={report[w.id] ?? null} onChange={v => setReport(r => ({ ...r, [w.id]: v }))} />
                <button className="btn-secondary btn-sm" disabled={!report[w.id]}
                  onClick={() => act(`Laporan penyaluran #${w.id}`, 'submitReport', [w.id, report[w.id]!.hash, report[w.id]!.cid])}>Catat laporan on-chain</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Form NGO: ajukan pencairan per milestone + unggah bukti ke IPFS. */
export function RequestWithdrawal({ c, reload }: Props) {
  const { send } = useTx();
  const [milestone, setMilestone] = useState(0);
  const [amount, setAmount] = useState(0);
  const [proof, setProof] = useState<UploadResult | null>(null);
  const m = c.milestones[milestone];
  const available = m ? m.budget - m.paid - m.reserved : 0n;
  const escrowFree = c.summary.balance - c.summary.reserved;
  const max = available < escrowFree ? available : escrowFree;
  return (
    <div className="card space-y-3">
      <h3 className="h2">Ajukan pencairan</h3>
      <div>
        <label className="label">Milestone</label>
        <select className="input" value={milestone} onChange={e => setMilestone(Number(e.target.value))}>
          {c.milestones.map((ms, i) => (
            <option key={i} value={i}>{i + 1}. {c.meta.milestones?.[i]?.title ?? 'Milestone'} - sisa {rupiah(ms.budget - ms.paid - ms.reserved)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Nominal (maks {rupiah(max > 0n ? max : 0n)})</label>
        <input className="input" type="number" min={1} value={amount || ''} onChange={e => setAmount(Math.floor(Number(e.target.value)))} />
      </div>
      <FileUpload label="Bukti rencana penggunaan (invoice, RAB, kontrak vendor)" value={proof} onChange={setProof} />
      <button className="btn-primary w-full" disabled={!proof || amount <= 0 || BigInt(amount) > max}
        onClick={async () => {
          if (await send(`Ajukan pencairan ${rupiah(amount)}`, { address: c.address, abi: ABI.Campaign }, 'requestWithdrawal', [milestone, amount, proof!.hash, proof!.cid])) {
            setProof(null); setAmount(0); reload();
          }
        }}>Ajukan</button>
    </div>
  );
}

/** Verifikator: aktifkan / batalkan. NGO: batalkan campaign. */
export function AdminActions({ c, reload, isVerifier, isNgo }: Props & { isVerifier: boolean; isNgo: boolean }) {
  const { send } = useTx();
  const target = { address: c.address, abi: ABI.Campaign };
  const s = c.summary.state;
  if (s > 1 || (!isVerifier && !isNgo)) return null;
  return (
    <div className="card space-y-3">
      <h3 className="h2">{isVerifier ? 'Aksi verifikator' : 'Aksi NGO'}</h3>
      {isVerifier && s === 0 && (
        <>
          <Notice>Periksa legalitas NGO, wallet penerima, dan rencana milestone sebelum mengaktifkan.</Notice>
          <button className="btn-primary w-full" onClick={async () => { if (await send('Aktifkan campaign', target, 'activate', [])) reload(); }}>Verifikasi & aktifkan</button>
        </>
      )}
      <button className="btn-danger w-full" onClick={async () => {
        const reason = prompt('Alasan pembatalan (tercatat on-chain). Sisa escrow akan dapat di-refund ke donatur:');
        if (reason && await send('Batalkan campaign', target, 'cancel', [reason])) reload();
      }}>Batalkan campaign</button>
    </div>
  );
}

/** Refund untuk donatur bila campaign dibatalkan (FR-10). */
export function RefundPanel({ c, reload }: Props) {
  const cfg = useConfig();
  const { account } = useWallet();
  const { send } = useTx();
  const [amount, setAmount] = useState<bigint | null>(null);
  const [other, setOther] = useState('');
  useEffect(() => {
    if (account) contracts(cfg).campaign(c.address).refundableOf(account).then(setAmount).catch(() => {});
  }, [account, c, cfg]);
  if (c.summary.state !== 3) return null;
  const claim = async (who: string) => { if (await send('Klaim refund', { address: c.address, abi: ABI.Campaign }, 'claimRefund', [who])) reload(); };
  return (
    <div className="card space-y-3">
      <h3 className="h2">Refund</h3>
      <p className="text-sm text-slate-600">Campaign dibatalkan. Sisa dana escrow dibagi proporsional sesuai kontribusi tiap donatur.</p>
      {account && <div className="text-sm">Hak refund Anda: <b>{amount === null ? '…' : rupiah(amount)}</b></div>}
      {account && amount !== null && amount > 0n && <button className="btn-primary w-full" onClick={() => claim(account)}>Klaim refund dIDR</button>}
      <div className="flex gap-2">
        <input className="input" placeholder="0x… alamat donatur lain" value={other} onChange={e => setOther(e.target.value)} />
        <button className="btn-secondary" onClick={() => claim(other)} disabled={!/^0x[0-9a-fA-F]{40}$/.test(other)}>Picu</button>
      </div>
      <p className="text-xs text-slate-500">Siapa pun dapat memicu refund, tetapi dana selalu dikirim ke alamat donatur itu sendiri.</p>
    </div>
  );
}
