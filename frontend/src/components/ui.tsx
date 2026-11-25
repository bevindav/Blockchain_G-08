'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { short, pct } from '@/lib/format';
import { CAMPAIGN_STATES, WITHDRAWAL_STATES } from '@/lib/types';

export function Addr({ a, n = 4, label }: { a?: string | null; n?: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!a) return <span>-</span>;
  return (
    <button type="button" title={a} className="mono inline text-left text-brand-700 hover:underline"
      onClick={() => { navigator.clipboard?.writeText(a); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      {label ?? short(a, n)}{copied && <span className="ml-1 text-emerald-600">✓ disalin</span>}
    </button>
  );
}

export function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  if (!hash) return <span>-</span>;
  return <Link href={`/explorer?tx=${hash}`} className="mono text-brand-700 hover:underline" title={hash}>{label ?? short(hash, 6)}</Link>;
}

export function Progress({ value, max, reserved }: { value: bigint; max: bigint; reserved?: bigint }) {
  const p = Math.min(100, pct(value, max));
  const r = reserved ? Math.min(100 - p, pct(reserved, max)) : 0;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full bg-brand-600" style={{ width: `${p}%` }} />
      {r > 0 && <div className="h-full bg-amber-400" style={{ width: `${r}%` }} />}
    </div>
  );
}

const STATE_COLORS = ['bg-amber-100 text-amber-800', 'bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800', 'bg-rose-100 text-rose-800'];
export const CampaignBadge = ({ state }: { state: number }) =>
  <span className={`badge ${STATE_COLORS[state]}`}>{CAMPAIGN_STATES[state]}</span>;

const W_COLORS = ['bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-800', 'bg-emerald-100 text-emerald-800', 'bg-rose-100 text-rose-800', 'bg-slate-200 text-slate-700'];
export const WithdrawalBadge = ({ status }: { status: number }) =>
  <span className={`badge ${W_COLORS[status]}`}>{WITHDRAWAL_STATES[status]}</span>;

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const c = { info: 'border-sky-200 bg-sky-50 text-sky-800', warn: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[kind];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}
