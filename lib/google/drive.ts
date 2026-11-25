import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config';
import { dataPath } from '../db';
import { GoogleError, accessToken, googleFetch } from './oauth';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  description: string | null;
  createdTime: string;
  appProperties: Record<string, string>;
}

export interface StreamResult {
  status: number; // 200 or 206
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

export interface UploadMeta {
  name: string;
  mimeType: string;
  parents: string[];
  appProperties?: Record<string, string>;
  description?: string;
}

export interface DriveBackend {
  createFolder(name: string, parentId: string | null, appProperties?: Record<string, string>): Promise<string>;
  findFolder(name: string, parentId: string | null): Promise<string | null>;
  isAlive(id: string): Promise<boolean>;
  listChildren(folderId: string): Promise<DriveFile[]>;
  findByAppProperty(folderId: string, key: string, value: string): Promise<DriveFile | null>;
  uploadFile(localPath: string, meta: UploadMeta): Promise<DriveFile>;
  stream(id: string, range?: string | null): Promise<StreamResult>;
  downloadTo(id: string, dest: string): Promise<void>;
  trash(id: string): Promise<void>;
  setDescription(id: string, description: string): Promise<void>;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export function folderIdFromUrl(url: string): string | null {
  const m = /folders\/([A-Za-z0-9_-]+)/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

/** Drive resumable chunk size: 8 MiB (multiple of 256 KiB). */
export const DRIVE_CHUNK = 8 * 1024 * 1024;
export function driveChunks(size: number, chunk = DRIVE_CHUNK): { start: number; end: number }[] {
  if (chunk % (256 * 1024) !== 0) throw new Error('chunk must be a multiple of 256 KiB');
  const out: { start: number; end: number }[] = [];
  for (let s = 0; s < size; s += chunk) out.push({ start: s, end: Math.min(size, s + chunk) - 1 });
  if (size === 0) out.push({ start: 0, end: -1 });
  return out;
}

const FIELDS = 'id,name,mimeType,size,description,createdTime,appProperties';
const API = 'https://www.googleapis.com/drive/v3/files';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function toFile(j: Record<string, unknown>): DriveFile {
  return {
    id: String(j.id),
    name: String(j.name ?? ''),
    mimeType: String(j.mimeType ?? ''),
    size: Number(j.size ?? 0),
    description: (j.description as string) ?? null,
    createdTime: String(j.createdTime ?? new Date().toISOString()),
    appProperties: (j.appProperties as Record<string, string>) ?? {},
  };
}

class GoogleDrive implements DriveBackend {
  private async list(query: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams({ q: query, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive' });
      if (pageToken) p.set('pageToken', pageToken);
      const r = await googleFetch(`${API}?${p}`);
      const j = (await r.json()) as { files: Record<string, unknown>[]; nextPageToken?: string };
      out.push(...j.files.map(toFile));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }
  async createFolder(name: string, parentId: string | null, appProperties: Record<string, string> = {}) {
    const r = await googleFetch(`${API}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties: { app: 'smprd', ...appProperties } }),
    });
    return ((await r.json()) as { id: string }).id;
  }
  async findFolder(name: string, parentId: string | null) {
    const parts = [`name = '${q(name)}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false'];
    if (parentId) parts.push(`'${q(parentId)}' in parents`);
    const f = await this.list(parts.join(' and '));
    return f[0]?.id ?? null;
  }
  async isAlive(id: string) {
    try {
      const r = await googleFetch(`${API}/${encodeURIComponent(id)}?fields=id,trashed`, {}, { retries: 3 });
      return !((await r.json()) as { trashed?: boolean }).trashed;
    } catch (e) {
      if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) return false;
      throw e;
    }
  }
  listChildren(folderId: string) {
    return this.list(`'${q(folderId)}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`);
  }
  async findByAppProperty(folderId: string, key: string, value: string) {
    const f = await this.list(`'${q(folderId)}' in parents and trashed = false and appProperties has { key='${q(key)}' and value='${q(value)}' }`);
    return f[0] ?? null;
  }
  async uploadFile(localPath: string, meta: UploadMeta) {
    const size = (await fsp.stat(localPath)).size;
    const init = await googleFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(FIELDS)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': meta.mimeType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties, description: meta.description }),
    });
    const session = init.headers.get('location');
    if (!session) throw new Error('Drive did not return an upload session');
    const fh = await fsp.open(localPath, 'r');
    try {
      let offset = 0;
      let failures = 0;
      while (true) {
        const end = Math.min(size, offset + DRIVE_CHUNK) - 1;
        const len = end - offset + 1;
        const buf = Buffer.alloc(Math.max(0, len));
        if (len > 0) await fh.read(buf, 0, len, offset);
        let res: Response;
        try {
          res = await googleFetch(session, {
            method: 'PUT',
            headers: { 'Content-Range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end}/${size}`, 'Content-Length': String(len) },
            body: buf,
          }, { retries: 1 });
        } catch (e) {
          if (++failures > 5) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** failures));
          // Ask the session how much it has.
          const st = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}`, Authorization: `Bearer ${await accessToken()}` } });
          if (st.status === 200 || st.status === 201) return toFile(await st.json());
          const rg = st.headers.get('range');
          offset = rg ? Number(rg.split('-')[1]) + 1 : 0;
          continue;
        }
        if (res.status === 200 || res.status === 201) return toFile(await res.json());
        if (res.status === 308) {
          const rg = res.headers.get('range');
          offset = rg ? Number(rg.split('-')[1]) + 1 : 0;
          continue;
        }
        throw new Error(`Unexpected Drive upload status ${res.status}`);
      }
    } finally {
      await fh.close();
    }
  }
  async stream(id: string, range?: string | null): Promise<StreamResult> {
    const headers: Record<string, string> = {};
    if (range) headers.Range = range;
    const r = await googleFetch(`${API}/${encodeURIComponent(id)}?alt=media`, { headers });
    const h: Record<string, string> = {};
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = r.headers.get(k);
      if (v) h[k] = v;
    }
    h['accept-ranges'] ??= 'bytes';
    return { status: r.status === 206 ? 206 : 200, headers: h, body: r.body! };
  }
  async downloadTo(id: string, dest: string) {
    const s = await this.stream(id);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    await new Promise<void>((resolve, reject) => {
      const w = fs.createWriteStream(tmp);
      Readable.fromWeb(s.body as import('node:stream/web').ReadableStream).pipe(w).on('finish', () => resolve()).on('error', reject);
    });
    await fsp.rename(tmp, dest);
  }
  async trash(id: string) {
    await googleFetch(`${API}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }
  async setDescription(id: string, description: string) {
    await googleFetch(`${API}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
  }
}

/** Local-disk stand-in for Drive (demo mode / tests). */
export class LocalDrive implements DriveBackend {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private metaPath(id: string) {
    return path.join(this.root, `${id}.json`);
  }
  private read(id: string): (DriveFile & { parents: string[]; trashed: boolean; folder: boolean }) | null {
    try {
      return JSON.parse(fs.readFileSync(this.metaPath(id), 'utf8'));
    } catch {
      return null;
    }
  }
  private write(f: DriveFile & { parents: string[]; trashed: boolean; folder: boolean }) {
    fs.writeFileSync(this.metaPath(f.id), JSON.stringify(f));
  }
  private all() {
    return fs
      .readdirSync(this.root)
      .filter((n) => n.endsWith('.json'))
      .map((n) => this.read(n.slice(0, -5))!)
      .filter(Boolean);
  }
  async createFolder(name: string, parentId: string | null, appProperties: Record<string, string> = {}) {
    const id = 'f' + crypto.randomBytes(10).toString('hex');
    this.write({ id, name, mimeType: FOLDER_MIME, size: 0, description: null, createdTime: new Date().toISOString(), appProperties: { app: 'smprd', ...appProperties }, parents: parentId ? [parentId] : [], trashed: false, folder: true });
    return id;
  }
  async findFolder(name: string, parentId: string | null) {
    return this.all().find((f) => f.folder && !f.trashed && f.name === name && (!parentId || f.parents.includes(parentId)))?.id ?? null;
  }
  async isAlive(id: string) {
    const f = this.read(id);
    return !!f && !f.trashed;
  }
  async listChildren(folderId: string) {
    return this.all().filter((f) => !f.folder && !f.trashed && f.parents.includes(folderId));
  }
  async findByAppProperty(folderId: string, key: string, value: string) {
    return (await this.listChildren(folderId)).find((f) => f.appProperties[key] === value) ?? null;
  }
  async uploadFile(localPath: string, meta: UploadMeta) {
    const id = 'x' + crypto.randomBytes(10).toString('hex');
    await fsp.copyFile(localPath, path.join(this.root, `${id}.bin`));
    const size = (await fsp.stat(localPath)).size;
    const f = { id, name: meta.name, mimeType: meta.mimeType, size, description: meta.description ?? null, createdTime: new Date().toISOString(), appProperties: meta.appProperties ?? {}, parents: meta.parents, trashed: false, folder: false };
    this.write(f);
    return f;
  }
  async stream(id: string, range?: string | null): Promise<StreamResult> {
    const p = path.join(this.root, `${id}.bin`);
    const size = (await fsp.stat(p)).size;
    const meta = this.read(id)!;
    return rangeStream(p, size, meta.mimeType, range);
  }
  async downloadTo(id: string, dest: string) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(path.join(this.root, `${id}.bin`), dest);
  }
  async trash(id: string) {
    const f = this.read(id);
    if (f) this.write({ ...f, trashed: true });
    fs.rmSync(path.join(this.root, `${id}.bin`), { force: true }); // free the disk space
  }
  async setDescription(id: string, description: string) {
    const f = this.read(id);
    if (f) this.write({ ...f, description });
  }
}

/** Parse a single "bytes=a-b" range against a size. */
export function parseByteRange(range: string | null | undefined, size: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  let start: number, end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!n) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export function rangeStream(file: string, size: number, mimeType: string, range?: string | null): StreamResult {
  const r = parseByteRange(range, size);
  const headers: Record<string, string> = { 'content-type': mimeType, 'accept-ranges': 'bytes' };
  if (r) {
    headers['content-range'] = `bytes ${r.start}-${r.end}/${size}`;
    headers['content-length'] = String(r.end - r.start + 1);
    const s = fs.createReadStream(file, { start: r.start, end: r.end });
    return { status: 206, headers, body: Readable.toWeb(s) as ReadableStream<Uint8Array> };
  }
  headers['content-length'] = String(size);
  return { status: 200, headers, body: Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array> };
}

const g = globalThis as unknown as { __smprdDrive?: DriveBackend };
export function drive(): DriveBackend {
  if (!g.__smprdDrive) {
    const c = config();
    g.__smprdDrive = c.demo ? new LocalDrive(dataPath('demo-drive')) : c.standalone ? new LocalDrive(dataPath('media')) : new GoogleDrive();
  }
  return g.__smprdDrive;
}
export function setDriveBackend(b: DriveBackend | undefined) {
  g.__smprdDrive = b;
}
