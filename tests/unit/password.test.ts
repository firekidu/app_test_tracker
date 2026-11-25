import { describe, expect, it } from 'vitest';
import { checkPassword } from '@/lib/password-policy';

const ok = (password: string, extra: { username?: string; displayName?: string } = {}) => checkPassword({ password, minLength: 15, ...extra });

describe('password policy (5.12)', () => {
  it('needs 15 characters', () => {
    expect(ok('tiger lamp rive')).toBeNull(); // 15 chars
    expect(ok('tiger lamp riv')).toMatch(/at least 15/); // 14 chars
    expect(ok('tiger lamp river')).toBeNull(); // 16 chars
    expect(ok('blue kettle sun')).toBeNull(); // exactly 15
  });
  it('never allows a minimum below 15', () => {
    expect(checkPassword({ password: 'short but 14ch', minLength: 8 })).toMatch(/at least 15/);
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
    expect(ok('🍕🍕🍕🍕🍕🍕🍕 abcdefg')).toBeNull(); // 15 graphemes
    expect(ok('🍕🍕🍕🍕🍕🍕 abcdefg')).toMatch(/at least 15/); // 14
  });
  it('caps at 128', () => {
    expect(ok('word '.repeat(30))).toMatch(/at most/);
  });
});
