import crypto from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords';

const COMMON = new Set(COMMON_PASSWORDS);
const MAX = 128;
/** Lowest password length the tracker accepts (PASSWORD_MIN_LENGTH can only raise it). */
export const MIN_PASSWORD_LENGTH = 6;

export interface PolicyInput {
  password: string;
  username?: string;
  displayName?: string;
  minLength: number;
}

/** Count user-perceived characters (each Unicode code point / emoji counts once). */
export function charCount(s: string): number {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...seg.segment(s)].length;
  } catch {
    return [...s].length;
  }
}

function isRunOrSequence(p: string): boolean {
  const cps = [...p].map((c) => c.codePointAt(0)!);
  if (cps.length < 3) return false;
  if (new Set(cps).size === 1) return true;
  const d = cps[1] - cps[0];
  if (Math.abs(d) === 1 && cps.every((c, i) => i === 0 || c - cps[i - 1] === d)) return true;
  // digit sequences that wrap, e.g. 123456789012345
  if (/^\d+$/.test(p)) {
    const up = '01234567890123456789012345678901234567890123456789';
    const down = '98765432109876543210987654321098765432109876543210';
    if (up.includes(p) || down.includes(p)) return true;
  }
  // a short unit repeated, e.g. abcabcabcabcabc
  for (let n = 1; n <= Math.floor(p.length / 3); n++) {
    const unit = p.slice(0, n);
    if (unit.repeat(Math.ceil(p.length / n)).slice(0, p.length) === p) return true;
  }
  return false;
}

/** Returns a plain-words problem, or null when the password is acceptable. */
export function checkPassword({ password, username, displayName, minLength }: PolicyInput): string | null {
  const len = charCount(password);
  const min = Math.max(MIN_PASSWORD_LENGTH, minLength);
  if (len < min) return `Use at least ${min} characters – a short sentence works well.`;
  if (len > MAX) return `Use at most ${MAX} characters.`;
  const lower = password.toLowerCase().trim();
  const squashed = lower.replace(/\s+/g, '');
  if (COMMON.has(lower) || COMMON.has(squashed)) return 'That password is too common. Try a few unrelated words.';
  for (const bad of ['password', 'smprd']) {
    const rest = squashed.split(bad).join('').replace(/[^\p{L}]/gu, '');
    if (squashed.includes(bad) && rest.length < 6) return 'That password is too easy to guess. Try a few unrelated words.';
  }
  if (username && squashed.includes(username.toLowerCase()) && squashed.length - username.length < 6)
    return "Don't use your username as your password.";
  if (displayName) {
    const dn = displayName.toLowerCase().replace(/\s+/g, '');
    if (dn && (squashed === dn || (squashed.includes(dn) && squashed.length - dn.length < 6))) return "Don't use your name as your password.";
  }
  if (isRunOrSequence(password)) return 'Avoid repeated or sequential characters like "aaaa…" or "1234…".';
  return null;
}

/** Have I Been Pwned k-anonymity check: only the first 5 hex chars of the SHA-1 leave the server. */
export async function isPwned(password: string): Promise<boolean> {
  const sha = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha.slice(0, 5);
  const suffix = sha.slice(5);
  try {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
    if (!r.ok) return false;
    const text = await r.text();
    return text.split('\n').some((l) => {
      const [s, n] = l.trim().split(':');
      return s === suffix && Number(n) > 0;
    });
  } catch {
    return false; // fail open: the local rules still apply
  }
}
