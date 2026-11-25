'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AppIcon, PasswordInput } from '@/components/ui';

export default function PasswordForm({ forced, minLength, name }: { forced: boolean; minLength: number; name: string }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const len = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(pw)].length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError('The two new passwords are different.');
    if (len < minLength) return setError(`Use at least ${minLength} characters – a short sentence works well.`);
    setBusy(true);
    try {
      const r = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: pw, confirmPassword: pw2 }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) return setError(j.message || 'Could not change the password.');
      window.location.href = '/?pw=changed';
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    window.location.href = '/login';
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand">
          <AppIcon />
          <div>
            <h1>Change password</h1>
            <p>{forced ? `Welcome, ${name}. Choose your own password to continue.` : name}</p>
          </div>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="cur">{forced ? 'Temporary password' : 'Current password'}</label>
          <PasswordInput id="cur" value={cur} onChange={setCur} autoComplete="current-password" required />
        </div>
        <div className="field">
          <label htmlFor="pw">New password</label>
          <PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="new-password" required />
          <span className="hint">
            At least {minLength} characters ({len} so far). No symbols or capitals needed – a short sentence of unrelated words works well.
          </span>
        </div>
        <div className="field">
          <label htmlFor="pw2">Confirm new password</label>
          <PasswordInput id="pw2" value={pw2} onChange={setPw2} autoComplete="new-password" required />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !cur || !pw || !pw2}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
        <p className="auth-foot">
          Changing your password signs you out on your other devices.{' '}
          {forced ? (
            <button type="button" className="btn ghost small" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <Link href="/">Back to the tracker</Link>
          )}
        </p>
      </form>
    </main>
  );
}
