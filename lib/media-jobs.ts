import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import PQueue from 'p-queue';
import sharp from 'sharp';
import { dataPath, db, getSetting, nowIso } from './db';
import { drive, folderIdFromUrl, rangeStream, type StreamResult } from './google/drive';
import { GoogleError } from './google/oauth';
import {
  HttpError,
  ensureDriveRoot,
  ensureRowFolder,
  logMediaChange,
  mediaSummary,
  snapshot,
  touchMedia,
} from './sheet-store';
import { getUpload, setUploadStatus, tempExists, tempPath, type UploadRow } from './uploads';

interface Queues {
  photo: PQueue;
  video: PQueue;
}
const g = globalThis as unknown as { __smprdQueues?: Queues };
function queues(): Queues {
  return (g.__smprdQueues ??= { photo: new PQueue({ concurrency: 2 }), video: new PQueue({ concurrency: 1 }) });
}
export function queueLength() {
  const q = queues();
  return q.photo.size + q.photo.pending + q.video.size + q.video.pending;
}

export function enqueueUpload(id: string, kind: 'photo' | 'video') {
  void queues()[kind].add(() => processUpload(id));
}

export const cachePath = (fileId: string, role: 'thumb' | 'display' | 'preview') =>
  dataPath('cache', `${fileId}-${role}.${role === 'preview' ? 'mp4' : 'jpg'}`);

function run(cmd: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

interface Probe {
  codec: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  formatName: string;
}
async function ffprobe(file: string): Promise<Probe | null> {
  try {
    const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 60_000);
    if (r.code !== 0) return null;
    const j = JSON.parse(r.stdout) as {
      streams?: { codec_type: string; codec_name: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
      format?: { duration?: string; format_name?: string };
    };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    let w = v?.width ?? null;
    let h = v?.height ?? null;
    const rot = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? 0));
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    return { codec: v?.codec_name ?? null, width: w, height: h, duration: j.format?.duration ? Number(j.format.duration) : null, formatName: j.format?.format_name ?? '' };
  } catch {
    return null; // ffprobe not installed
  }
}

async function uploadDerivative(local: string, name: string, mimeType: string, originalId: string, role: 'thumb' | 'display' | 'preview') {
  const { previewsId } = await ensureDriveRoot();
  const f = await drive().uploadFile(local, {
    name,
    mimeType,
    parents: [previewsId],
    appProperties: { app: 'smprd', derivedFrom: originalId, role },
  });
  return f.id;
}

async function processUpload(id: string) {
  const u = getUpload(id);
  if (!u || u.status === 'cancelled' || u.status === 'done') return;
  const kind: 'photo' | 'video' = u.mime_type.startsWith('video/') ? 'video' : 'photo';
  const src = tempPath(id);
  try {
    if (!tempExists(id)) throw new Error('The uploaded file is no longer on the server. Upload it again.');
    setUploadStatus(id, 'uploading_to_drive', { error: null });
    const folder = await ensureRowFolder(u.row_number, u.row_key);
    const uploaderName = uploaderNameOf(u.uploader_username);
    let original = await drive().findByAppProperty(folder.folderId, 'uploadId', id);
    if (!original) {
      original = await drive().uploadFile(src, {
        name: u.file_name,
        mimeType: u.mime_type,
        parents: [folder.folderId],
        appProperties: { app: 'smprd', rowKey: u.row_key.slice(0, 100), uploader: u.uploader_username, kind, uploadId: id },
      });
    }
    // Record early so the panel can show "processing".
    db()
      .prepare(
        `INSERT INTO media(file_id, folder_id, row_key, name, mime_type, kind, size, uploader_username, uploader_name, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing')
         ON CONFLICT(file_id) DO UPDATE SET status = 'processing'`,
      )
      .run(original.id, folder.folderId, u.row_key, u.file_name, u.mime_type, kind, u.size, u.uploader_username, uploaderName, nowIso());
    touchMedia();
    setUploadStatus(id, 'processing');

    const d: { width?: number | null; height?: number | null; duration?: number | null; thumb?: string; display?: string; preview?: string } = {};
    let note = '';
    if (kind === 'photo') {
      let input: Buffer = await fsp.readFile(src);
      const isHeic = /heic|heif/.test(u.mime_type);
      if (isHeic) {
        const convert = (await import('heic-convert')).default;
        input = Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 0.92 }));
      }
      const img = sharp(input, { failOn: 'none' }).rotate();
      const meta = await img.metadata();
      const swap = (meta.orientation ?? 1) >= 5;
      d.width = (swap ? meta.height : meta.width) ?? null;
      d.height = (swap ? meta.width : meta.height) ?? null;
      const thumbLocal = cachePath(original.id, 'thumb');
      await sharp(input, { failOn: 'none' }).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbLocal);
      d.thumb = await uploadDerivative(thumbLocal, `${original.id}-thumb.jpg`, 'image/jpeg', original.id, 'thumb');
      const needsDisplay = isHeic || u.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(u.mime_type);
      if (needsDisplay) {
        const dispLocal = cachePath(original.id, 'display');
        await sharp(input, { failOn: 'none' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(dispLocal);
        d.display = await uploadDerivative(dispLocal, `${original.id}-display.jpg`, 'image/jpeg', original.id, 'display');
      }
    } else {
      const p = await ffprobe(src);
      if (!p) {
        note = 'ffmpeg is not available on the server; no thumbnail was made.';
      } else {
        d.width = p.width;
        d.height = p.height;
        d.duration = p.duration;
        const at = p.duration !== null && p.duration < 1.5 ? '0' : '1';
        const thumbLocal = cachePath(original.id, 'thumb');
        const t = await run('ffmpeg', ['-y', '-v', 'error', '-ss', at, '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumbLocal], 120_000);
        if (t.code === 0 && fs.existsSync(thumbLocal)) d.thumb = await uploadDerivative(thumbLocal, `${original.id}-thumb.jpg`, 'image/jpeg', original.id, 'thumb');
        const isMp4 = /mp4/.test(p.formatName) && u.mime_type === 'video/mp4';
        if (p.codec !== 'h264' || !isMp4) {
          setUploadStatus(id, 'processing');
          const prevLocal = cachePath(original.id, 'preview');
          const tmpOut = `${prevLocal}.tmp.mp4`;
          const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmpOut]);
          if (r.code !== 0) {
            await fsp.rm(tmpOut, { force: true });
            throw Object.assign(new Error('Video could not be converted – the original was saved; download it to view.'), { keepOriginal: true });
          }
          await fsp.rename(tmpOut, prevLocal);
          d.preview = await uploadDerivative(prevLocal, `${original.id}-preview.mp4`, 'video/mp4', original.id, 'preview');
        }
      }
    }
    db()
      .prepare(
        `UPDATE media SET width = ?, height = ?, duration_s = ?, thumb_file_id = ?, display_file_id = ?, preview_file_id = ?, status = 'ready' WHERE file_id = ?`,
      )
      .run(d.width ?? null, d.height ?? null, d.duration ?? null, d.thumb ?? null, d.display ?? null, d.preview ?? null, original.id);
    await logMediaChange(u.row_key, 'Media added', '', u.file_name, { name: uploaderName }, note);
    await fsp.rm(src, { force: true });
    setUploadStatus(id, 'done', { media_file_id: original.id, error: null });
    touchMedia();
  } catch (e) {
    const err = e as Error & { keepOriginal?: boolean };
    let msg = err.message || 'Processing failed.';
    if (e instanceof GoogleError && e.reason === 'storageQuotaExceeded') msg = 'Google Drive is full. Free up space or add storage to the Google account.';
    if (e instanceof HttpError && e.status === 409) msg = 'This row changed in Google Sheets. Refresh and try again.';
    console.error(`[media] upload ${id} failed:`, msg);
    if (err.keepOriginal) {
      db().prepare("UPDATE media SET status = 'failed' WHERE file_id IN (SELECT file_id FROM media WHERE row_key = ? AND name = ? ORDER BY created_at DESC LIMIT 1)").run(u.row_key, u.file_name);
      touchMedia();
    }
    setUploadStatus(id, 'failed', { error: msg });
  }
}

function uploaderNameOf(username: string): string {
  const r = db().prepare('SELECT name, person_name FROM "user" WHERE username = ?').get(username) as { name: string; person_name: string | null } | undefined;
  return r?.person_name || r?.name || username;
}

export function retryFailedUploads(): number {
  const rows = db().prepare("SELECT * FROM uploads WHERE status = 'failed'").all() as UploadRow[];
  let n = 0;
  for (const u of rows) {
    if (!tempExists(u.id)) continue;
    setUploadStatus(u.id, 'queued', { error: null });
    enqueueUpload(u.id, u.mime_type.startsWith('video/') ? 'video' : 'photo');
    n++;
  }
  return n;
}

// ---------- serving ----------
export interface MediaRecord {
  file_id: string;
  folder_id: string;
  row_key: string;
  name: string;
  mime_type: string;
  kind: 'photo' | 'video';
  size: number;
  caption: string | null;
  uploader_username: string | null;
  uploader_name: string | null;
  thumb_file_id: string | null;
  display_file_id: string | null;
  preview_file_id: string | null;
  status: string;
}
export function getMedia(fileId: string): MediaRecord | undefined {
  return db().prepare('SELECT * FROM media WHERE file_id = ?').get(fileId) as MediaRecord | undefined;
}
export function mediaForRowKey(key: string) {
  return (db().prepare('SELECT * FROM media WHERE row_key = ? ORDER BY created_at ASC').all(key) as Parameters<typeof mediaSummary>[0][]).map(mediaSummary);
}

async function ensureCached(derivId: string, local: string) {
  if (fs.existsSync(local)) return;
  await drive().downloadTo(derivId, local);
}

export async function thumbStream(m: MediaRecord): Promise<StreamResult | null> {
  if (!m.thumb_file_id) return null;
  const local = cachePath(m.file_id, 'thumb');
  await ensureCached(m.thumb_file_id, local);
  const st = await fsp.stat(local);
  return rangeStream(local, st.size, 'image/jpeg');
}

export async function viewStream(m: MediaRecord, range: string | null): Promise<StreamResult> {
  const deriv = m.kind === 'photo' ? (m.display_file_id ? { id: m.display_file_id, role: 'display' as const, mime: 'image/jpeg' } : null) : m.preview_file_id ? { id: m.preview_file_id, role: 'preview' as const, mime: 'video/mp4' } : null;
  if (deriv) {
    const local = cachePath(m.file_id, deriv.role);
    try {
      await ensureCached(deriv.id, local);
      const st = await fsp.stat(local);
      return rangeStream(local, st.size, deriv.mime, range);
    } catch (e) {
      console.warn('[media] cache miss, streaming from Drive:', (e as Error).message);
      return drive().stream(deriv.id, range);
    }
  }
  const s = await drive().stream(m.file_id, range);
  s.headers['content-type'] = m.mime_type;
  return s;
}

export async function deleteMedia(m: MediaRecord, actorName: string) {
  for (const id of [m.file_id, m.thumb_file_id, m.display_file_id, m.preview_file_id]) {
    if (!id) continue;
    try {
      await drive().trash(id);
    } catch (e) {
      if (!(e instanceof GoogleError && e.status === 404)) throw e;
    }
  }
  for (const role of ['thumb', 'display', 'preview'] as const) await fsp.rm(cachePath(m.file_id, role), { force: true });
  db().prepare('DELETE FROM media WHERE file_id = ?').run(m.file_id);
  touchMedia();
  await logMediaChange(m.row_key, 'Media deleted', m.name, '', { name: actorName });
}

export async function setCaption(m: MediaRecord, caption: string, actorName: string) {
  const c = caption.trim().slice(0, 500);
  if ((m.caption ?? '') === c) return;
  await drive().setDescription(m.file_id, c);
  db().prepare('UPDATE media SET caption = ? WHERE file_id = ?').run(c, m.file_id);
  touchMedia();
  await logMediaChange(m.row_key, 'Caption', m.caption ?? '', c, { name: actorName }, m.name);
}

async function derivativeMap(): Promise<Map<string, Record<string, string>>> {
  const previewsId = getSetting('drivePreviewsFolderId');
  const derivs = new Map<string, Record<string, string>>();
  if (previewsId) {
    for (const f of await drive().listChildren(previewsId)) {
      const from = f.appProperties.derivedFrom;
      if (!from) continue;
      derivs.set(from, { ...(derivs.get(from) ?? {}), [f.appProperties.role ?? 'thumb']: f.id });
    }
  }
  return derivs;
}

/** Index the app-created files in one row folder. Returns the Drive ids found. */
async function indexFolder(fid: string, rowKey: string, derivs: Map<string, Record<string, string>>): Promise<string[]> {
  const list = await drive().listChildren(fid);
  const originals = list.filter((f) => f.appProperties.app === 'smprd' && !f.appProperties.derivedFrom);
  for (const f of originals) {
    const dv = derivs.get(f.id) ?? {};
    const kind = f.appProperties.kind === 'video' || f.mimeType.startsWith('video/') ? 'video' : 'photo';
    const uploader = f.appProperties.uploader ?? null;
    db()
      .prepare(
        `INSERT INTO media(file_id, folder_id, row_key, name, mime_type, kind, size, caption, uploader_username, uploader_name, created_at, thumb_file_id, display_file_id, preview_file_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
         ON CONFLICT(file_id) DO UPDATE SET folder_id = excluded.folder_id, row_key = excluded.row_key, name = excluded.name, caption = excluded.caption,
           thumb_file_id = COALESCE(excluded.thumb_file_id, media.thumb_file_id), display_file_id = COALESCE(excluded.display_file_id, media.display_file_id),
           preview_file_id = COALESCE(excluded.preview_file_id, media.preview_file_id), status = 'ready'`,
      )
      .run(f.id, fid, rowKey, f.name, f.mimeType, kind, f.size, f.description, uploader, uploader ? uploaderNameOf(uploader) : null, f.createdTime, dv.thumb ?? null, dv.display ?? null, dv.preview ?? null);
  }
  return originals.map((f) => f.id);
}

/** Used when a row's media list is empty locally but column K links a folder (e.g. after /data was lost). */
export async function scanRowFolder(rowKey: string, folderUrl: string) {
  const fid = folderIdFromUrl(folderUrl);
  if (!fid) return [];
  const ids = await indexFolder(fid, rowKey, await derivativeMap());
  if (ids.length) touchMedia();
  return mediaForRowKey(rowKey);
}

/** Re-scan the Drive folders linked in column K and rebuild the media table. */
export async function rebuildMediaIndex(): Promise<{ files: number; rows: number }> {
  const snap = await snapshot();
  const derivs = await derivativeMap();
  let files = 0;
  let rows = 0;
  const seen = new Set<string>();
  for (const r of snap.rows) {
    const fid = folderIdFromUrl(r.mediaFolderUrl);
    if (!fid) continue;
    let ids: string[];
    try {
      ids = await indexFolder(fid, r.rowKey, derivs);
    } catch {
      continue;
    }
    if (ids.length) rows++;
    files += ids.length;
    ids.forEach((id) => seen.add(id));
  }
  // Remove entries whose files are gone
  const all = db().prepare('SELECT file_id FROM media').all() as { file_id: string }[];
  for (const { file_id } of all) if (!seen.has(file_id)) db().prepare('DELETE FROM media WHERE file_id = ?').run(file_id);
  touchMedia();
  return { files, rows };
}

export async function clearCache() {
  const dir = dataPath('cache');
  let n = 0;
  for (const f of await fsp.readdir(dir)) {
    await fsp.rm(`${dir}/${f}`, { force: true });
    n++;
  }
  return n;
}
