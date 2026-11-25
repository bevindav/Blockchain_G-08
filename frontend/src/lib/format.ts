export const rupiah = (v: bigint | number | string) => {
  const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)));
  return 'Rp' + n.toLocaleString('id-ID');
};
export const short = (a?: string | null, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : '-');
export const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export const dateOnly = (ts: number) => new Date(ts * 1000).toLocaleDateString('id-ID', { dateStyle: 'long' });
export const pct = (a: bigint, b: bigint) => (b === 0n ? 0 : Number((a * 10000n) / b) / 100);
export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const daysLeft = (deadline: number) => Math.ceil((deadline * 1000 - Date.now()) / 86_400_000);
