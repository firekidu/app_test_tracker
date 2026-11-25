import crypto from 'node:crypto';
import { config } from './config';

function key(): Buffer {
  const raw = config().ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : crypto.createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(blob: string): string {
  const b = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Random password of the given length from an unambiguous alphabet. */
export function randomPassword(len = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
  const out: string[] = [];
  while (out.length < len) {
    const b = crypto.randomBytes(len * 2);
    for (const x of b) {
      if (x < 256 - (256 % alphabet.length) && out.length < len) out.push(alphabet[x % alphabet.length]);
    }
  }
  return out.join('');
}
