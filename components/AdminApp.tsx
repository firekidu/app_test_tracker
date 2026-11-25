'use client';
import { ArrowLeft, CheckCircle2, Copy, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Person } from '@/lib/types';
import { AppIcon, ConfirmDialog, Dialog, ToastProvider, api, useToast } from './ui';

interface Status {
  demo: boolean;
  mode: 'demo' | 'local' | 'google';
  google: { configured: boolean; connected: boolean; email: string | null; scopes: string[]; connectedAt: string | null; lostError: string | null; redirectUri: string };
  checks: { step: string; label: string; ok: boolean; detail?: string }[];
  health: { syncedAt: string | null; error: string | null; queue: number; disk: { freeMb: number; totalMb: number } | null; failedUploads: number };
  settings: { stallDays: number };
}
interface UserRow {
  id: string;
  username: string;
  displayName: string;
  personName: string;
  role: string;
  status: 'active' | 'locked' | 'disabled';
  mustChangePassword: boolean;
  lastSignIn: string | null;
}
interface AuthEvent {
  id: number;
  at: string;
  username: string | null;
  event: string;
  by_username: string | null;
  ip: string | null;
}
interface SheetLite {
  people: Person[];
  rows: { reporterRaw: string; reporterKnown: boolean; ownerRaw: string; ownerKnown: boolean }[];
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STEP_FIX: Record<string, string> = {
  'k1-header': 'Write "Media" into K1',
  'change-log-tab': 'Create the Change log tab',
  'people-tab': 'Create the People tab (pre-filled from the sheet)',
  'drive-root': 'Create the SMPRD Media folder in Drive',
  'previews-folder': 'Create the _previews folder',
};

export default function AdminApp({ me }: { me: { username: string; displayName: string } }) {
  return (
    <ToastProvider>
      <Admin me={me} />
    </ToastProvider>
  );
}

function SecretOnce({ title, username, password, onClose }: { title: string; username: string; password: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog title={title} onClose={onClose}>
      <p>
        Temporary password for <strong>{username}</strong>. It is shown <strong>once</strong>. Send the username and the password separately (for example the username by email and the password by phone). They will choose their own password when they first sign in.
      </p>
      <div className="secret-box">
        <code>{password}</code>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void navigator.clipboard.writeText(password).then(() => toast('Copied.'));
          }}
        >
          <Copy className="icon" /> Copy
        </button>
      </div>
      <div className="row-btns">
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function Admin({ me }: { me: { username: string; displayName: string } }) {
  const toast = useToast();
  const [st, setSt] = useState<Status | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [sheet, setSheet] = useState<SheetLite | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; username: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [stall, setStall] = useState('');

  const load = useCallback(async () => {
    const [s, u, e] = await Promise.all([api<Status>('GET', '/api/admin/status'), api<UserRow[]>('GET', '/api/admin/users'), api<AuthEvent[]>('GET', '/api/admin/auth-events')]);
    setSt(s);
    setStall(String(s.settings.stallDays));
    setUsers(u);
    setEvents(e);
    try {
      setSheet(await api<SheetLite>('GET', '/api/sheet'));
    } catch {}
  }, []);

  useEffect(() => {
    void load().catch((e) => toast((e as Error).message, true));
    const p = new URLSearchParams(window.location.search);
    if (p.get('google') === 'connected') toast('Google connected.');
    if (p.get('google') === 'error') toast(`Google connection failed: ${p.get('message') ?? ''}`, true);
    if (p.get('google')) window.history.replaceState(null, '', '/admin');
  }, [load, toast]);

  async function act(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try {
      await fn();
      if (ok) toast(ok);
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const userAction = (u: UserRow, action: string, body?: unknown) => api<{ temporaryPassword?: string }>('POST', `/api/admin/users/${u.id}/${action}`, body ?? {});

  const unknownNames = (() => {
    if (!sheet) return [];
    const s = new Map<string, number>();
    for (const r of sheet.rows) {
      if (!r.reporterKnown && r.reporterRaw.trim()) s.set(r.reporterRaw.trim(), (s.get(r.reporterRaw.trim()) ?? 0) + 1);
      if (!r.ownerKnown && r.ownerRaw.trim()) s.set(r.ownerRaw.trim(), (s.get(r.ownerRaw.trim()) ?? 0) + 1);
    }
    return [...s.entries()].sort((a, b) => b[1] - a[1]);
  })();

  return (
    <>
      <header className="header">
        <div className="brand">
          <AppIcon />
          <div>
            <h1>Admin</h1>
            <div className="sync-line">Signed in as {me.displayName}</div>
          </div>
        </div>
        <div className="actions">
          <Link className="btn" href="/">
            <ArrowLeft className="icon" /> Back to the sheet
          </Link>
        </div>
      </header>
      <main className="page admin-grid">
        {!st ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {st.mode === 'google' ? (
              <>
            <section className="section" aria-labelledby="g-h">
              <h2 id="g-h">Google connection</h2>
              {st.demo ? (
                <p className="muted">Demo mode – Google is not used on this server.</p>
              ) : (
                <>
                  <dl className="kv">
                    <dt>Status</dt>
                    <dd>{st.google.connected ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Connected</span> : <span className="danger-text" style={{ fontWeight: 600 }}>{st.google.lostError ? 'Connection lost' : 'Not connected'}</span>}</dd>
                    <dt>Account</dt>
                    <dd>{st.google.email ?? '—'}</dd>
                    <dt>Scopes granted</dt>
                    <dd style={{ fontSize: 12 }}>{st.google.scopes.length ? st.google.scopes.join(', ') : '—'}</dd>
                    <dt>Redirect URI</dt>
                    <dd className="mono" style={{ fontSize: 12 }}>
                      {st.google.redirectUri}
                    </dd>
                  </dl>
                  {!st.google.configured && (
                    <div className="form-error" style={{ marginTop: 12 }}>
                      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ENCRYPTION_KEY must be set on the server before Google can be connected.
                    </div>
                  )}
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <a className={`btn primary${st.google.configured ? '' : ' disabled'}`} href={st.google.configured ? '/api/admin/google/connect' : undefined} aria-disabled={!st.google.configured}>
                      {st.google.connected || st.google.lostError ? 'Reconnect Google' : 'Connect Google'}
                    </a>
                    {(st.google.connected || st.google.lostError) && (
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() =>
                          setConfirm({
                            title: 'Disconnect Google',
                            message: 'The app will stop syncing with the sheet until Google is connected again.',
                            label: 'Disconnect',
                            danger: true,
                            run: () => act('disc', () => api('POST', '/api/admin/google/disconnect'), 'Disconnected.'),
                          })
                        }
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className="section" aria-labelledby="s-h">
              <h2 id="s-h">
                Setup checks{' '}
                <button type="button" className="btn small ghost" onClick={() => act('reload', async () => undefined)} aria-label="Re-run checks">
                  <RefreshCw className="icon" />
                </button>
              </h2>
              <div className="checks">
                {st.checks.map((c) => (
                  <div className="check" key={c.step}>
                    {c.ok ? <CheckCircle2 className="icon ok" /> : <XCircle className="icon no" />}
                    <span>{c.label}</span>
                    {c.detail && <span className="detail">{c.detail}</span>}
                    {!c.ok && STEP_FIX[c.step] && (
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy !== null}
                        onClick={() =>
                          setConfirm({
                            title: 'Fix setup',
                            message: `${STEP_FIX[c.step]}?`,
                            label: 'Yes, do it',
                            run: () => act(c.step, () => api('POST', `/api/admin/setup/${c.step}`), 'Done.'),
                          })
                        }
                      >
                        {busy === c.step ? 'Working…' : 'Fix'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

              </>
            ) : (
              <DataSection demo={st.demo} act={act} />
            )}

            <section className="section" aria-labelledby="u-h">
              <h2 id="u-h">Users</h2>
              <div className="btn-row" style={{ marginBottom: 10 }}>
                <button type="button" className="btn primary" onClick={() => setAddOpen(true)}>
                  Add user
                </button>
              </div>
              <div className="table-wrap">
                <table className="plain">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Display name</th>
                      <th>People name</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last sign-in</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="mono">{u.username}</td>
                        <td>{u.displayName}</td>
                        <td>
                          <select
                            className="input"
                            style={{ minHeight: 30, padding: '2px 6px', fontSize: 12.5 }}
                            value={u.personName}
                            aria-label={`People name for ${u.username}`}
                            onChange={(e) => act(`p-${u.id}`, () => userAction(u, 'profile', { personName: e.target.value }), 'Saved.')}
                          >
                            <option value="">—</option>
                            {(sheet?.people ?? []).map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                            {u.personName && !(sheet?.people ?? []).some((p) => p.name === u.personName) && <option value={u.personName}>{u.personName}</option>}
                          </select>
                        </td>
                        <td>
                          <select
                            className="input"
                            style={{ minHeight: 30, padding: '2px 6px', fontSize: 12.5 }}
                            value={u.role}
                            aria-label={`Role for ${u.username}`}
                            onChange={(e) => act(`r-${u.id}`, () => userAction(u, 'role', { role: e.target.value }), 'Role changed.')}
                          >
                            <option value="admin">admin</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                        </td>
                        <td>
                          <span className={`status-pill ${u.status}`}>{u.status}</span>
                          {u.mustChangePassword && u.status === 'active' && <div className="muted" style={{ fontSize: 11 }}>must change password</div>}
                        </td>
                        <td style={{ fontSize: 12 }}>{fmt(u.lastSignIn)}</td>
                        <td>
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn small"
                              onClick={() =>
                                setConfirm({
                                  title: 'Reset password',
                                  message: `Give ${u.username} a new temporary password? They will be signed out everywhere.`,
                                  label: 'Reset password',
                                  run: () =>
                                    act(`rp-${u.id}`, async () => {
                                      const r = await userAction(u, 'reset-password');
                                      setSecret({ title: 'Password reset', username: u.username, password: r.temporaryPassword! });
                                    }),
                                })
                              }
                            >
                              Reset password
                            </button>
                            {u.status === 'locked' && (
                              <button type="button" className="btn small" onClick={() => act(`ul-${u.id}`, () => userAction(u, 'unlock'), 'Unlocked.')}>
                                Unlock
                              </button>
                            )}
                            {u.status === 'disabled' ? (
                              <button type="button" className="btn small" onClick={() => act(`en-${u.id}`, () => userAction(u, 'enable'), 'Enabled.')}>
                                Enable
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn small danger"
                                disabled={u.username === me.username}
                                onClick={() =>
                                  setConfirm({
                                    title: 'Disable account',
                                    message: `Disable ${u.username}? They are signed out at once. Their history stays.`,
                                    label: 'Disable',
                                    danger: true,
                                    run: () => act(`d-${u.id}`, () => userAction(u, 'disable'), 'Disabled.'),
                                  })
                                }
                              >
                                Disable
                              </button>
                            )}
                            <button type="button" className="btn small ghost" onClick={() => act(`so-${u.id}`, () => userAction(u, 'sign-out-all'), 'Signed out everywhere.')}>
                              Sign out everywhere
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sign-in history (latest {events.length})</summary>
                <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}>
                  <table className="plain">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Username</th>
                        <th>Event</th>
                        <th>By</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontSize: 12 }}>{fmt(e.at)}</td>
                          <td className="mono">{e.username}</td>
                          <td>{e.event.replace(/_/g, ' ')}</td>
                          <td>{e.by_username ?? ''}</td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {e.ip ?? ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>

            <PeopleSection sheet={sheet} unknownNames={unknownNames} act={act} />

            <section className="section" aria-labelledby="set-h">
              <h2 id="set-h">Settings</h2>
              <form
                className="btn-row"
                style={{ alignItems: 'flex-end' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('stall', () => api('PATCH', '/api/admin/settings', { stallDays: Number(stall) }), 'Saved.');
                }}
              >
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="stall">Stall warning after (days without activity)</label>
                  <input id="stall" className="input" type="number" min={1} max={365} value={stall} onChange={(e) => setStall(e.target.value)} style={{ width: 120 }} />
                </div>
                <button className="btn" type="submit">
                  Save
                </button>
              </form>
            </section>

            <section className="section" aria-labelledby="m-h">
              <h2 id="m-h">Maintenance</h2>
              <div className="btn-row">
                <button type="button" className="btn" disabled={busy !== null} onClick={() => act('rebuild', async () => { const r = await api<{ files: number; rows: number }>('POST', '/api/admin/media/rebuild'); toast(`Found ${r.files} files on ${r.rows} rows.`); })}>
                  {busy === 'rebuild' ? 'Scanning…' : 'Rebuild media index'}
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => act('retry', async () => { const r = await api<{ retried: number }>('POST', '/api/admin/uploads/retry'); toast(`Retrying ${r.retried} upload(s).`); })}>
                  Retry failed uploads ({st.health.failedUploads})
                </button>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => act('cache', async () => { const r = await api<{ removed: number }>('POST', '/api/admin/cache/clear'); toast(`Removed ${r.removed} cached files.`); })}>
                  Clear cache
                </button>
              </div>
            </section>

            <section className="section" aria-labelledby="h-h">
              <h2 id="h-h">Health</h2>
              <dl className="kv">
                <dt>Last sync</dt>
                <dd>{fmt(st.health.syncedAt)}</dd>
                <dt>Last error</dt>
                <dd className={st.health.error ? 'danger-text' : ''}>{st.health.error ?? 'None'}</dd>
                <dt>Queue length</dt>
                <dd>{st.health.queue}</dd>
                <dt>Disk space on /data</dt>
                <dd>{st.health.disk ? `${(st.health.disk.freeMb / 1024).toFixed(1)} GB free of ${(st.health.disk.totalMb / 1024).toFixed(1)} GB` : '—'}</dd>
              </dl>
            </section>
          </>
        )}
      </main>
      {addOpen && (
        <AddUserDialog
          people={sheet?.people ?? []}
          onClose={() => setAddOpen(false)}
          onCreated={async (username, password) => {
            setAddOpen(false);
            setSecret({ title: 'Account created', username, password });
            await load();
          }}
        />
      )}
      {secret && <SecretOnce {...secret} onClose={() => setSecret(null)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const c = confirm;
            setConfirm(null);
            await c.run();
          }}
        />
      )}
    </>
  );
}

function AddUserDialog({ people, onClose, onCreated }: { people: Person[]; onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [personName, setPersonName] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Add user" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const r = await api<{ user: { username: string }; temporaryPassword: string }>('POST', '/api/admin/users', { username, displayName, personName, role });
            onCreated(r.user.username, r.temporaryPassword);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="nu-u">Username</label>
          <input id="nu-u" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" spellCheck={false} required />
          <span className="hint">3–30 characters: letters, digits, “.”, “-” and “_”. Stored in lower case.</span>
        </div>
        <div className="field">
          <label htmlFor="nu-d">Display name</label>
          <input id="nu-d" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="nu-p">People name</label>
            <select id="nu-p" className="input" value={personName} onChange={(e) => setPersonName(e.target.value)}>
              <option value="">—</option>
              {people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nu-r">Role</label>
            <select id="nu-r" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PeopleSection({ sheet, unknownNames, act }: { sheet: SheetLite | null; unknownNames: [string, number][]; act: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [edit, setEdit] = useState<Person | null>(null);
  const [merge, setMerge] = useState<Person | null>(null);
  const people = sheet?.people ?? [];
  return (
    <section className="section" aria-labelledby="p-h">
      <h2 id="p-h">People (names for Reported By and Bug Owner)</h2>
      <p className="sub">The names offered in the Reported By and Bug Owner pickers. This is not the list of logins.</p>
      <div className="table-wrap">
        <table className="plain">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sheet spellings</th>
              <th>Active</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td style={{ fontSize: 12 }}>{p.spellings.join(', ')}</td>
                <td>
                  <input type="checkbox" checked={p.active} aria-label={`${p.name} active`} onChange={(e) => act(`a-${p.name}`, () => api('PATCH', `/api/admin/people/${encodeURIComponent(p.name)}`, { active: e.target.checked }), 'Saved.')} />
                </td>
                <td style={{ fontSize: 12 }}>
                  {p.addedBy} {p.addedOn}
                </td>
                <td>
                  <div className="btn-row">
                    <button type="button" className="btn small" onClick={() => setEdit(p)}>
                      Edit
                    </button>
                    <button type="button" className="btn small" onClick={() => setMerge(p)} disabled={people.length < 2}>
                      Merge into…
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!people.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No People tab yet. Use the setup check above to create it.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {unknownNames.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>Names in the sheet not in People</h3>
          <div className="btn-row">
            {unknownNames.map(([n, count]) => (
              <span key={n} className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', gap: 6 }}>
                {n} ({count})
                <button
                  type="button"
                  className="btn small"
                  style={{ minHeight: 22 }}
                  onClick={() => {
                    const guess = n.includes('@') ? n.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : n;
                    void act(`add-${n}`, () => api('POST', '/api/people', { name: guess, spellings: guess === n ? [] : [n] }), `Added ${guess}.`);
                  }}
                >
                  Add
                </button>
              </span>
            ))}
          </div>
        </>
      )}
      {edit && <EditPersonDialog p={edit} onClose={() => setEdit(null)} act={act} />}
      {merge && <MergeDialog p={merge} people={people} onClose={() => setMerge(null)} act={act} />}
    </section>
  );
}

function EditPersonDialog({ p, onClose, act }: { p: Person; onClose: () => void; act: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [name, setName] = useState(p.name);
  const [sp, setSp] = useState(p.spellings.join(', '));
  return (
    <Dialog title={`Edit ${p.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act('edit', () => api('PATCH', `/api/admin/people/${encodeURIComponent(p.name)}`, { newName: name, spellings: sp.split(',').map((s) => s.trim()).filter(Boolean) }), 'Saved.');
          onClose();
        }}
      >
        <div className="field">
          <label htmlFor="ep-n">Name</label>
          <input id="ep-n" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ep-s">Sheet spellings</label>
          <input id="ep-s" className="input" value={sp} onChange={(e) => setSp(e.target.value)} />
          <span className="hint">Comma-separated. Renaming keeps the old name as a spelling.</span>
        </div>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MergeDialog({ p, people, onClose, act }: { p: Person; people: Person[]; onClose: () => void; act: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const others = people.filter((x) => x.name !== p.name);
  const [target, setTarget] = useState(others[0]?.name ?? '');
  const [rows, setRows] = useState(false);
  return (
    <Dialog title={`Merge ${p.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act('merge', () => api('PATCH', `/api/admin/people/${encodeURIComponent(p.name)}`, { mergeInto: target, updateRows: rows }), 'Merged.');
          onClose();
        }}
      >
        <p>
          “{p.name}” and its spellings become spellings of the name you choose. Old rows keep their text but display the chosen name.
        </p>
        <div className="field">
          <label htmlFor="mg-t">Merge into</label>
          <select id="mg-t" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((o) => (
              <option key={o.name}>{o.name}</option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 14 }}>
          <input type="checkbox" checked={rows} onChange={(e) => setRows(e.target.checked)} /> Also update existing rows (rewrites those Reported By / Bug Owner cells and logs each one)
        </label>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!target}>
            Merge
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DataSection({ demo, act }: { demo: boolean; act: (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  async function run() {
    if (!file) return;
    await act('import', async () => {
      const r = await fetch(`/api/admin/import?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Import failed.');
      toast(`Imported ${j.imported} rows (now ${j.total}). ${j.namesAdded ? `${j.namesAdded} new names added to People.` : ''}`);
    });
  }
  return (
    <section className="section" aria-labelledby="d-h">
      <h2 id="d-h">Data</h2>
      <p className="sub">
        {demo
          ? 'Demo mode: data is kept in memory only.'
          : 'Rows, names and the change log are stored in the tracker database on this server; photos and videos on its disk. Google is not used.'}
      </p>
      <div className="btn-row" style={{ alignItems: 'center', marginBottom: 14 }}>
        <a className="btn" href="/api/export" download>
          Export all rows (CSV)
        </a>
        <span className="muted" style={{ fontSize: 12.5 }}>Opens in Excel or Google Sheets.</span>
        <button type="button" className="btn danger" onClick={() => setClearing(true)}>
          Clear all rows
        </button>
      </div>
      {clearing && (
        <ConfirmDialog
          title="Clear all rows"
          message="Remove every row (for example the SAMPLE rows) so you can start fresh or import your own sheet. Users and names are kept. Continue?"
          confirmLabel="Clear all rows"
          danger
          onCancel={() => setClearing(false)}
          onConfirm={async () => {
            setClearing(false);
            await act('clear', async () => {
              const r = await fetch('/api/admin/import?mode=replace', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'Bugs\n' });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.message || 'Could not clear the rows.');
            }, 'All rows cleared.');
          }}
        />
      )}
      <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Import rows from CSV</h3>
      <p className="sub" style={{ margin: '0 0 10px' }}>
        In Google Sheets use File → Download → Comma-separated values. The first row must be the header (Bugs, Priority, Reported By, Status, Reported Date, End date, Milestone, Bug Owner, Deliverable, Notes). New names in Reported By / Bug Owner are added to People.
      </p>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <select className="input" style={{ width: 'auto', minHeight: 32 }} value={mode} onChange={(e) => setMode(e.target.value as 'replace' | 'append')} aria-label="Import mode">
          <option value="append">Add to the existing rows</option>
          <option value="replace">Replace all rows</option>
        </select>
        <button type="button" className="btn primary" disabled={!file} onClick={() => (mode === 'replace' ? setConfirm(true) : void run())}>
          Import
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Replace all rows"
          message="All current rows are replaced by the rows in the file. Photos and videos stay attached to rows whose date and text are unchanged. Continue?"
          confirmLabel="Replace rows"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            await run();
          }}
        />
      )}
    </section>
  );
}
