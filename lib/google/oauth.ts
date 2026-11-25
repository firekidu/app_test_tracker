import fs from 'node:fs';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { dataPath } from '../db';
import { decrypt, encrypt } from '../crypto';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
  'profile',
];

interface StoredToken {
  refresh_token: string;
  email: string | null;
  scopes: string[];
  connectedAt: string;
}

const g = globalThis as unknown as {
  __smprdGoogle?: { token?: StoredToken | null; access?: { token: string; exp: number }; lostError?: string | null };
};
const state = () => (g.__smprdGoogle ??= {});

const tokenFile = () => dataPath('secrets', 'google.json.enc');

export function oauthClient() {
  const c = config();
  return new OAuth2Client({
    clientId: c.GOOGLE_CLIENT_ID,
    clientSecret: c.GOOGLE_CLIENT_SECRET,
    redirectUri: `${c.APP_URL.replace(/\/$/, '')}/api/admin/google/callback`,
  });
}

export function googleConfigured() {
  const c = config();
  return !!(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.ENCRYPTION_KEY);
}

export function authUrl(csrfState: string) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state: csrfState,
    include_granted_scopes: true,
  });
}

export function storedToken(): StoredToken | null {
  const s = state();
  if (s.token !== undefined) return s.token;
  try {
    s.token = JSON.parse(decrypt(fs.readFileSync(tokenFile(), 'utf8'))) as StoredToken;
  } catch {
    s.token = null;
  }
  return s.token;
}

export function googleConnected() {
  return !!storedToken() && !state().lostError;
}
export function googleLostError() {
  return state().lostError ?? null;
}

export async function handleCallback(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
  let email: string | null = null;
  if (tokens.access_token) {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (r.ok) email = ((await r.json()) as { email?: string }).email ?? null;
  }
  const t: StoredToken = {
    refresh_token: tokens.refresh_token,
    email,
    scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    connectedAt: new Date().toISOString(),
  };
  fs.writeFileSync(tokenFile(), encrypt(JSON.stringify(t)), { mode: 0o600 });
  const s = state();
  s.token = t;
  s.lostError = null;
  s.access = tokens.access_token
    ? { token: tokens.access_token, exp: (tokens.expiry_date ?? Date.now() + 3000_000) - 60_000 }
    : undefined;
  return t;
}

export function disconnectGoogle() {
  try {
    fs.unlinkSync(tokenFile());
  } catch {}
  const s = state();
  s.token = null;
  s.access = undefined;
}

export class GoogleError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
  ) {
    super(message);
  }
}

export const GOOGLE_LOST = 'Google connection lost. An admin needs to reconnect Google in Admin.';

export async function accessToken(): Promise<string> {
  const s = state();
  if (s.access && s.access.exp > Date.now()) return s.access.token;
  const t = storedToken();
  if (!t) throw new GoogleError('Google is not connected. An admin needs to connect Google in Admin.', 503, 'not_connected');
  const client = oauthClient();
  client.setCredentials({ refresh_token: t.refresh_token });
  try {
    const r = await client.refreshAccessToken();
    const at = r.credentials.access_token!;
    s.access = { token: at, exp: (r.credentials.expiry_date ?? Date.now() + 3000_000) - 60_000 };
    s.lostError = null;
    return at;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/invalid_grant|unauthorized_client|invalid_client/i.test(msg)) {
      s.lostError = msg;
      throw new GoogleError(GOOGLE_LOST, 503, 'lost');
    }
    throw new GoogleError(`Could not reach Google: ${msg}`, 503, 'network');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with Google auth, retrying 429/5xx with exponential backoff + jitter (max 5 tries). */
export async function googleFetch(url: string, init: RequestInit = {}, opts: { retries?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 5;
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      if (attempt >= retries) throw new GoogleError(`Could not reach Google: ${(e as Error).message}`, 503, 'network');
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 2, 32000);
      continue;
    }
    if (res.status === 401 && attempt < retries) {
      state().access = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 2, 32000);
      continue;
    }
    if (!res.ok && res.status !== 308 && res.status !== 206) {
      let body = '';
      try {
        body = await res.text();
      } catch {}
      let reason: string | undefined;
      let message = `Google error ${res.status}`;
      try {
        const j = JSON.parse(body);
        reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status;
        message = j?.error?.message ?? message;
      } catch {}
      if (reason === 'storageQuotaExceeded') message = 'Google Drive is full. Free up space or add storage to the Google account.';
      throw new GoogleError(message, res.status, reason);
    }
    return res;
  }
}
