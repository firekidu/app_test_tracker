import type { StreamResult } from './google/drive';

export function streamResponse(s: StreamResult, extra: Record<string, string> = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(s.headers)) h.set(k, v);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(s.body, { status: s.status, headers: h });
}

export function contentDisposition(name: string, type: 'attachment' | 'inline' = 'attachment') {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
