import { describe, expect, it } from 'vitest';
import { checkPassword } from '@/lib/password-policy';

const ok = (password: string, extra: { username?: string; displayName?: string } = {}) => checkPassword({ password, minLength: 6, ...extra });

describe('password policy (5.12)', () => {
  it('needs 6 characters', () => {
    expect(ok('tiger7')).toBeNull(); // 6 chars
    expect(ok('tiger')).toMatch(/at least 6/); // 5 chars
    expect(ok('tiger lamp river')).toBeNull();
  });
  it('never allows a minimum below 6, but a higher setting still applies', () => {
    expect(checkPassword({ password: 'abc', minLength: 2 })).toMatch(/at least 6/);
    expect(checkPassword({ password: 'tiger lamp', minLength: 12 })).toMatch(/at least 12/);
  });
  it('rejects repeated and sequential runs', () => {
    expect(ok('aaaaaaaaaaaaaaa')).not.toBeNull();
    expect(ok('123456789012345')).not.toBeNull();
    expect(ok('abcabcabcabcabc')).not.toBeNull();
  });
  it('rejects common passwords and the username', () => {
    expect(ok('123456789012345')).not.toBeNull();
    expect(ok('qwertyuiop12345')).toMatch(/too common/); // in bundled list
    expect(ok('QwertyUIOP12345')).toMatch(/too common/);
    expect(ok('Gautham.VR.Testing', { username: 'gautham.vr.testing' })).toMatch(/username/);
    expect(ok('gautham.vr.testing 1', { username: 'gautham.vr.testing' })).toMatch(/username/);
    expect(ok('David Thomas 12', { displayName: 'David Thomas' })).toMatch(/name/);
    expect(ok('smprdsmprdsmprd')).not.toBeNull();
  });
  it('accepts spaces and emoji, no composition rules', () => {
    expect(ok('my cat likes 🍕 on fridays')).toBeNull();
    expect(ok('all lower case words here')).toBeNull();
  });
  it('counts emoji once', () => {
    expect(ok('🍕🍕🍕 ab')).toBeNull(); // 6 graphemes
    expect(ok('🍕🍕🍕 a')).toMatch(/at least 6/); // 5
  });
  it('caps at 128', () => {
    expect(ok('word '.repeat(30))).toMatch(/at most/);
  });
});
