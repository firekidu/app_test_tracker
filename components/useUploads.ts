'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaSummary } from '@/lib/types';

export type UpStatus = 'waiting' | 'sending' | 'stopped' | 'queued' | 'uploading_to_drive' | 'processing' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  localId: string;
  rowNumber: number;
  rowKey: string;
  name: string;
  size: number;
  type: string;
  status: UpStatus;
  bytesAcked: number;
  error?: string;
  uploadId?: string;
  media?: MediaSummary;
}

interface Internal {
  file: File;
  acked: Set<number>;
  chunkSize: number;
  total: number;
  abort: AbortController;
}

const OK_EXT = /\.(jpe?g|png|webp|heic|heif|mp4|mov|m4v)$/i;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime'];
const MAX_PARALLEL_FILES = 3;
const STOPPED_MSG = 'Upload stopped – check your connection. Tap Retry to continue from where it stopped.';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useUploads(opts: { maxMb: number; onDone: () => void; toast: (t: string, err?: boolean) => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const internals = useRef(new Map<string, Internal>());
  const running = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    itemsRef.current = itemsRef.current.map((x) => (x.localId === id ? { ...x, ...p } : x));
    setItems((xs) => xs.map((x) => (x.localId === id ? { ...x, ...p } : x)));
  }, []);

  const pump = useCallback(() => {
    const waiting = itemsRef.current.filter((x) => x.status === 'waiting' && !running.current.has(x.localId));
    for (const w of waiting) {
      if (running.current.size >= MAX_PARALLEL_FILES) break;
      running.current.add(w.localId);
      void runOne(w.localId).finally(() => {
        running.current.delete(w.localId);
        setTimeout(() => pumpRef.current(), 0);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  async function runOne(id: string) {
    const item = itemsRef.current.find((x) => x.localId === id)!;
    const int = internals.current.get(id)!;
    patch(id, { status: 'sending', error: undefined });
    try {
      if (!item.uploadId) {
        const r = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row: item.rowNumber, rowKey: item.rowKey, fileName: item.name, size: item.size, mimeType: item.type }),
          signal: int.abort.signal,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.message || 'Could not start the upload.'), { fatal: true });
        int.chunkSize = j.chunkSize;
        int.total = j.chunksTotal;
        item.uploadId = j.uploadId;
        patch(id, { uploadId: j.uploadId });
      }
      const uploadId = item.uploadId!;
      const todo: number[] = [];
      for (let i = 0; i < int.total; i++) if (!int.acked.has(i)) todo.push(i);
      let next = 0;
      let failed: Error | null = null;
      const worker = async () => {
        while (next < todo.length && !failed) {
          const idx = todo[next++];
          const start = idx * int.chunkSize;
          const blob = int.file.slice(start, Math.min(item.size, start + int.chunkSize));
          let ok = false;
          for (let attempt = 0; attempt < 6 && !ok; attempt++) {
            if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1)); // 1, 2, 4, 8, 16 s
            if (int.abort.signal.aborted) throw new Error('cancelled');
            try {
              const r = await fetch(`/api/uploads/${uploadId}/chunks/${idx}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: blob,
                signal: int.abort.signal,
              });
              if (r.ok) ok = true;
              else if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408) {
                const j = await r.json().catch(() => ({}));
                throw Object.assign(new Error(j.message || 'Upload refused.'), { fatal: true });
              }
            } catch (e) {
              if ((e as { fatal?: boolean }).fatal || int.abort.signal.aborted) throw e;
            }
          }
          if (!ok) {
            failed = new Error(STOPPED_MSG);
            break;
          }
          int.acked.add(idx);
          const bytes = [...int.acked].reduce((a, i) => a + Math.min(int.chunkSize, item.size - i * int.chunkSize), 0);
          patch(id, { bytesAcked: bytes });
        }
      };
      await Promise.all([worker(), worker()]);
      if (failed) throw failed;
      const c = await fetch(`/api/uploads/${uploadId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok) throw Object.assign(new Error(cj.message || 'Could not finish the upload.'), { fatal: c.status !== 409 });
      patch(id, { status: 'queued', bytesAcked: item.size });
      // poll
      for (;;) {
        await sleep(1500);
        if (int.abort.signal.aborted) return;
        const s = await fetch(`/api/uploads/${uploadId}`).then((r) => r.json()).catch(() => null);
        if (!s) continue;
        patch(id, { status: s.status, error: s.error, media: s.media });
        if (s.status === 'done') {
          optsRef.current.onDone();
          setTimeout(() => setItems((xs) => xs.filter((x) => x.localId !== id)), 4000);
          return;
        }
        if (s.status === 'failed' || s.status === 'cancelled') {
          optsRef.current.onDone();
          return;
        }
      }
    } catch (e) {
      const err = e as Error & { fatal?: boolean };
      if (err.message === 'cancelled' || int.abort.signal.aborted || err.name === 'AbortError') return;
      patch(id, { status: err.fatal ? 'failed' : 'stopped', error: err.message });
    }
  }

  const addFiles = useCallback(
    (row: { rowNumber: number; rowKey: string }, files: FileList | File[]) => {
      const max = optsRef.current.maxMb * 1024 * 1024;
      const add: UploadItem[] = [];
      for (const f of Array.from(files)) {
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const okType = OK_TYPES.includes(f.type) || OK_EXT.test(f.name);
        const base: UploadItem = { localId, rowNumber: row.rowNumber, rowKey: row.rowKey, name: f.name, size: f.size, type: f.type, status: 'waiting', bytesAcked: 0 };
        if (!okType) {
          add.push({ ...base, status: 'failed', error: `${f.name} isn't a photo or video we can store (JPG, PNG, HEIC, MP4 or MOV).` });
          continue;
        }
        if (f.size > max) {
          add.push({ ...base, status: 'failed', error: `${f.name} is larger than ${optsRef.current.maxMb} MB. Trim the video or send a shorter clip.` });
          continue;
        }
        internals.current.set(localId, { file: f, acked: new Set(), chunkSize: 4 * 1024 * 1024, total: 0, abort: new AbortController() });
        add.push(base);
      }
      // Make the new items visible to the queue immediately (not only after the next render).
      itemsRef.current = [...itemsRef.current, ...add];
      setItems((xs) => [...xs, ...add]);
      setTimeout(() => pumpRef.current(), 0);
    },
    [],
  );

  const cancel = useCallback((localId: string) => {
    const it = itemsRef.current.find((x) => x.localId === localId);
    const int = internals.current.get(localId);
    int?.abort.abort();
    if (it?.uploadId) void fetch(`/api/uploads/${it.uploadId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
    setItems((xs) => xs.filter((x) => x.localId !== localId));
  }, []);

  const retry = useCallback((localId: string) => {
    const int = internals.current.get(localId);
    if (!int) return;
    int.abort = new AbortController();
    patch(localId, { status: 'waiting', error: undefined });
    setTimeout(() => pumpRef.current(), 0);
  }, [patch]);

  const dismiss = useCallback((localId: string) => setItems((xs) => xs.filter((x) => x.localId !== localId)), []);

  // Warn before leaving with unfinished transfers.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (itemsRef.current.some((x) => x.status === 'sending' || x.status === 'waiting')) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  return { items, addFiles, cancel, retry, dismiss, canRetry: (id: string) => internals.current.has(id) };
}
export type Uploads = ReturnType<typeof useUploads>;
