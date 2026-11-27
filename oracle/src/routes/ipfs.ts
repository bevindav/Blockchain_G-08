import { Router } from 'express';
import multer from 'multer';
import { keccak256 } from 'ethers';
import { config } from '../config';
import { HttpError, rateLimit } from '../http';

export const ipfs = Router();

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const internalGateway = process.env.IPFS_GATEWAY_INTERNAL || config.ipfsApiUrl.replace(':5001', ':8080');

/** Unggah ke node IPFS lokal (Kubo) atau Pinata bila PINATA_JWT diisi. File dipin agar tidak di-garbage-collect. */
async function addToIpfs(bytes: Buffer, name: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
  if (config.pinataJwt) {
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST', headers: { Authorization: `Bearer ${config.pinataJwt}` }, body: form, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new HttpError(502, `Pinata error ${res.status}`);
    return (await res.json()).IpfsHash;
  }
  const res = await fetch(`${config.ipfsApiUrl}/api/v0/add?pin=true&cid-version=1`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new HttpError(502, `IPFS error ${res.status}`);
  return (await res.json()).Hash;
}

function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  return null;
}

/**
 * POST /api/ipfs/upload (multipart, field "file", maks 5 MB, JPG/PNG/WEBP/GIF/PDF)
 * -> { cid, hash, size, mime, name, uri }
 * `hash` = keccak256(isi file) yang dicatat on-chain sebagai bukti & untuk deteksi bukti duplikat.
 */
ipfs.post('/upload', rateLimit(30, 60_000), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'File wajib diunggah (field "file")');
  const mime = sniff(file.buffer); // validasi dari isi file, bukan dari header yang bisa dipalsukan
  if (!mime || !ALLOWED.has(mime)) throw new HttpError(415, 'Hanya JPG, PNG, WEBP, GIF, atau PDF');
  const cid = await addToIpfs(file.buffer, file.originalname.replace(/[^\w.\-]/g, '_').slice(0, 80), mime);
  res.status(201).json({ cid, hash: keccak256(file.buffer), size: file.size, mime, name: file.originalname, uri: `ipfs://${cid}` });
});

/** POST /api/ipfs/json -> { cid } untuk metadata campaign (judul, deskripsi, milestone). */
ipfs.post('/json', rateLimit(30, 60_000), async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.title !== 'string' || !body.title.trim())
    throw new HttpError(400, 'Metadata wajib memiliki title');
  const json = Buffer.from(JSON.stringify(body));
  if (json.length > 64 * 1024) throw new HttpError(413, 'Metadata terlalu besar');
  const cid = await addToIpfs(json, 'metadata.json', 'application/json');
  res.status(201).json({ cid, hash: keccak256(json), uri: `ipfs://${cid}` });
});

/** GET /api/ipfs/:cid -> proxy ke gateway IPFS (dengan header keamanan agar konten tidak dieksekusi). */
ipfs.get('/:cid', async (req, res) => {
  const cid = String(req.params.cid);
  if (!/^[a-zA-Z0-9]{46,100}$/.test(cid)) throw new HttpError(400, 'CID tidak valid');
  const base = config.pinataJwt ? 'https://gateway.pinata.cloud' : internalGateway;
  const upstream = await fetch(`${base}/ipfs/${cid}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!upstream || !upstream.ok) throw new HttpError(upstream?.status === 404 ? 404 : 502, 'Konten IPFS tidak dapat diambil');
  const bytes = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // konten IPFS immutable
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.send(bytes);
});
