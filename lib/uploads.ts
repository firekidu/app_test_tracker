import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { config } from './config';
import { dataPath, db, nowIso } from './db';
import { HttpError, findRowByKey } from './sheet-store';

export const CHUNK_SIZE = 4 * 1024 * 1024;
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime'];
const EXT_OK = /\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v)$/i;

export function chunksTotal(size: number, chunk = CHUNK_SIZE) {
  return Math.max(1, Math.ceil(size / chunk));
}
export function expectedChunkLength(index: number, size: number, chunk = CHUNK_SIZE) {
  const start = index * chunk;
  if (index < 0 || start >= Math.max(size, 1)) return -1;
  return Math.min(size, start + chunk) - start;
}
export function chunkOffset(index: number, chunk = CHUNK_SIZE) {
  return index * chunk;
}

export function safeFileName(name: string): string {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!base) return 'file';
  if (base.length <= 120) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
  return base.slice(0, 120 - ext.length) + ext;
}

export interface UploadRow {
  id: string;
  row_number: number;
  row_key: string;
  file_name: string;
  mime_type: string;
  size: number;
  chunk_size: number;
  chunks_total: number;
  chunks_received: string;
  status: string;
  error: string | null;
  media_file_id: string | null;
  uploader_username: string;
  created_at: string;
  updated_at: string;
}

export const tempPath = (id: string) => dataPath('tmp', `${id}.part`);

export function getUpload(id: string): UploadRow | undefined {
  return db().prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
}
export function setUploadStatus(id: string, status: string, extra: { error?: string | null; media_file_id?: string | null } = {}) {
  db()
    .prepare('UPDATE uploads SET status = ?, error = COALESCE(?, error), media_file_id = COALESCE(?, media_file_id), updated_at = ? WHERE id = ?')
    .run(status, extra.error ?? null, extra.media_file_id ?? null, nowIso(), id);
  if (extra.error === null) db().prepare('UPDATE uploads SET error = NULL WHERE id = ?').run(id);
}

// ---- per-user rate limits (9. Security) ----
interface RateState { sec: number[]; bytes: { t: number; n: number }[] }
const g = globalThis as unknown as { __smprdRate?: Map<string, RateState> };
const rate = () => (g.__smprdRate ??= new Map<string, RateState>());
function checkRate(user: string, bytes: number) {
  const now = Date.now();
  const r: RateState = rate().get(user) ?? { sec: [], bytes: [] };
  r.sec = r.sec.filter((t) => now - t < 1000);
  r.bytes = r.bytes.filter((b) => now - b.t < 10 * 60_000);
  if (r.sec.length >= 30) throw new HttpError(429, 'Too many requests. Slow down.');
  const total = r.bytes.reduce((a, b) => a + b.n, 0);
  if (total + bytes > 200 * 1024 * 1024) throw new HttpError(429, 'Upload limit reached (200 MB per 10 minutes). Wait a few minutes and retry.');
  r.sec.push(now);
  r.bytes.push({ t: now, n: bytes });
  rate().set(user, r);
}

export function tooBigMessage(name: string) {
  return `${name} is larger than ${config().MAX_UPLOAD_MB} MB. Trim the video or send a shorter clip.`;
}
export function badTypeMessage(name: string) {
  return `${name} isn't a photo or video we can store (JPG, PNG, HEIC, MP4 or MOV).`;
}

export async function createUpload(input: { row: number; rowKey: string; fileName: string; size: number; mimeType: string }, username: string) {
  const c = config();
  const name = safeFileName(input.fileName);
  if (input.size > c.maxUploadBytes) throw new HttpError(413, tooBigMessage(name));
  if (input.size <= 0) throw new HttpError(422, `${name} is empty.`);
  const declared = (input.mimeType || '').toLowerCase();
  if (!ALLOWED_TYPES.includes(declared) && !EXT_OK.test(name)) throw new HttpError(415, badTypeMessage(name));
  const row = findRowByKey(input.rowKey);
  if (!row) throw new HttpError(409, 'This row changed in Google Sheets. Refresh and try again.');
  const id = crypto.randomUUID();
  const fh = await fsp.open(tempPath(id), 'w');
  await fh.truncate(input.size);
  await fh.close();
  const now = nowIso();
  const total = chunksTotal(input.size);
  db()
    .prepare(
      `INSERT INTO uploads(id, row_number, row_key, file_name, mime_type, size, chunk_size, chunks_total, chunks_received, status, uploader_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'receiving', ?, ?, ?)`,
    )
    .run(id, row.rowNumber, input.rowKey, name, declared || 'application/octet-stream', input.size, CHUNK_SIZE, total, username, now, now);
  return { uploadId: id, chunkSize: CHUNK_SIZE, chunksTotal: total };
}

export async function writeChunk(id: string, index: number, req: Request, username: string, isAdmin: boolean) {
  const u = getUpload(id);
  if (!u) throw new HttpError(404, 'Upload not found.');
  if (u.uploader_username !== username && !isAdmin) throw new HttpError(403, 'Not your upload.');
  if (u.status !== 'receiving') throw new HttpError(409, `Upload is ${u.status}.`);
  const expected = expectedChunkLength(index, u.size, u.chunk_size);
  if (expected < 0) throw new HttpError(400, 'Chunk index out of range.');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && req.headers.has('content-length') && declared !== expected)
    throw new HttpError(400, `Chunk ${index} must be ${expected} bytes.`);
  checkRate(username, expected);
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length !== expected) throw new HttpError(400, `Chunk ${index} must be ${expected} bytes.`);
  const fh = await fsp.open(tempPath(id), 'r+');
  try {
    await fh.write(buf, 0, buf.length, chunkOffset(index, u.chunk_size));
  } finally {
    await fh.close();
  }
  // synchronous read-modify-write: atomic within the event loop
  const cur = getUpload(id)!;
  const set = new Set<number>(JSON.parse(cur.chunks_received));
  set.add(index);
  db().prepare('UPDATE uploads SET chunks_received = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...set].sort((a, b) => a - b)), nowIso(), id);
  return { received: set.size, chunksTotal: u.chunks_total };
}

export async function completeUpload(id: string, username: string, isAdmin: boolean) {
  const u = getUpload(id);
  if (!u) throw new HttpError(404, 'Upload not found.');
  if (u.uploader_username !== username && !isAdmin) throw new HttpError(403, 'Not your upload.');
  if (u.status !== 'receiving') return { status: u.status };
  const got = new Set<number>(JSON.parse(u.chunks_received));
  for (let i = 0; i < u.chunks_total; i++) if (!got.has(i)) throw new HttpError(409, `Chunk ${i} is missing.`, { missing: i });
  const st = await fsp.stat(tempPath(id));
  if (st.size !== u.size) throw new HttpError(409, 'Size mismatch.');
  const ft = await fileTypeFromFile(tempPath(id));
  let mime = ft?.mime ?? '';
  if (mime === 'video/x-m4v') mime = 'video/mp4';
  if (mime === 'image/heic-sequence') mime = 'image/heic';
  if (mime === 'image/heif-sequence') mime = 'image/heif';
  if (!ALLOWED_TYPES.includes(mime)) {
    setUploadStatus(id, 'failed', { error: badTypeMessage(u.file_name) });
    await fsp.rm(tempPath(id), { force: true });
    throw new HttpError(415, badTypeMessage(u.file_name));
  }
  db().prepare("UPDATE uploads SET mime_type = ?, status = 'queued', updated_at = ? WHERE id = ?").run(mime, nowIso(), id);
  const { enqueueUpload } = await import('./media-jobs');
  enqueueUpload(id, mime.startsWith('video/') ? 'video' : 'photo');
  return { status: 'queued' };
}

export async function cancelUpload(id: string, username: string, isAdmin: boolean) {
  const u = getUpload(id);
  if (!u) throw new HttpError(404, 'Upload not found.');
  if (u.uploader_username !== username && !isAdmin) throw new HttpError(403, 'Not your upload.');
  if (['receiving', 'queued', 'failed'].includes(u.status)) {
    setUploadStatus(id, 'cancelled');
    await fsp.rm(tempPath(id), { force: true });
  }
  return { status: getUpload(id)!.status };
}

export async function cleanupUploads() {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const old = db().prepare("SELECT id FROM uploads WHERE status != 'done' AND updated_at < ?").all(cutoff) as { id: string }[];
  for (const { id } of old) {
    await fsp.rm(tempPath(id), { force: true });
    db().prepare('DELETE FROM uploads WHERE id = ?').run(id);
  }
  // stray temp files without a row
  try {
    for (const f of await fsp.readdir(dataPath('tmp'))) {
      const id = f.replace(/\.part$/, '');
      if (!getUpload(id)) {
        const st = await fsp.stat(dataPath('tmp', f));
        if (Date.now() - st.mtimeMs > 24 * 3600_000) await fsp.rm(dataPath('tmp', f), { force: true });
      }
    }
  } catch {}
  return old.length;
}

export function startUploadHousekeeping() {
  const k = globalThis as unknown as { __smprdHk?: NodeJS.Timeout };
  if (k.__smprdHk) return;
  k.__smprdHk = setInterval(() => void cleanupUploads().catch(() => undefined), 3600_000);
  k.__smprdHk.unref?.();
}

export const tempExists = (id: string) => fs.existsSync(tempPath(id));
