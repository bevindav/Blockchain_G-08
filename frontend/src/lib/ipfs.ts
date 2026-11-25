import type { CampaignMeta } from './types';

/** ipfs://CID, CID mentah, atau data: URI -> URL yang bisa dibuka browser (lewat proxy backend). */
export function ipfsUrl(uri?: string | null): string {
  if (!uri) return '';
  if (uri.startsWith('data:') || uri.startsWith('http')) return uri;
  const cid = uri.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');
  return `/api/ipfs/${cid}`;
}

const metaCache = new Map<string, Promise<CampaignMeta>>();

export function fetchMetadata(cid: string): Promise<CampaignMeta> {
  if (!cid) return Promise.resolve({ title: 'Campaign tanpa metadata' });
  if (!metaCache.has(cid)) {
    metaCache.set(cid, (async () => {
      try {
        const res = await fetch(ipfsUrl(cid));
        if (!res.ok) throw new Error();
        const m = await res.json();
        return { ...m, title: String(m.title || 'Campaign') } as CampaignMeta;
      } catch {
        metaCache.delete(cid);
        return { title: 'Metadata tidak dapat dimuat', description: `CID: ${cid}` };
      }
    })());
  }
  return metaCache.get(cid)!;
}
