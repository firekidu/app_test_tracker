'use client';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  History,
  Loader2,
  Image as ImageIcon,
  KeyRound,
  LogOut,
  Paperclip,
  Play,
  Plus,
  Search,
  Settings,
  User,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaSummary, Row, SheetPayload } from '@/lib/types';
import { NamePicker } from './NamePicker';
import Preview from './Preview';
import RowPanel from './RowPanel';
import { useUploads } from './useUploads';
import {
  AppIcon,
  ChipSelect,
  ConfirmDialog,
  Dialog,
  PRIORITIES,
  PriorityChip,
  STATUS_EDIT_ORDER,
  STATUS_ORDER,
  STATUS_STYLE,
  StatusChip,
  ToastProvider,
  api,
  prettyDate,
  statusLabel,
  isoFromUk,
  ukDate,
  useClickOutside,
  useToast,
} from './ui';

/** Status filter applied when the URL has none: In progress + TBD. */
const DEFAULT_STATUS = 'active';
const ACTIVE_STATUSES = ['In progress', 'TBD'];

type Filters = { status: string; owner: string; priority: string; q: string; newest: boolean; row: number | null; media: string | null };

function readUrl(): Filters {
  const p = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  return {
    status: p.get('status') ?? '',
    owner: p.get('owner') ?? '',
    priority: p.get('priority') ?? '',
    q: p.get('q') ?? '',
    newest: p.get('sort') === 'newest',
    row: p.get('row') ? Number(p.get('row')) : null,
    media: p.get('media'),
  };
}
function writeUrl(f: Filters, push: boolean) {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.owner) p.set('owner', f.owner);
  if (f.priority) p.set('priority', f.priority);
  if (f.q) p.set('q', f.q);
  if (f.newest) p.set('sort', 'newest');
  if (f.row) p.set('row', String(f.row));
  if (f.media) p.set('media', f.media);
  const url = `${window.location.pathname}${p.toString() ? `?${p}` : ''}`;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const h = () => setPhone(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return phone;
}

function useSheet() {
  const [data, setData] = useState<SheetPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ver = useRef<string | null>(null);
  const refresh = useCallback(async (force = false) => {
    try {
      const url = !force && ver.current ? `/api/sheet?v=${ver.current}` : '/api/sheet';
      const j = await api<SheetPayload & { unchanged?: boolean }>('GET', url);
      setLoadError(null);
      if (j.unchanged) {
        setData((d) => (d ? { ...d, syncedAt: j.syncedAt, sync: { ...d.sync, ...j.sync } } : d));
        return;
      }
      ver.current = j.version;
      setData(j);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh(true);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    const vis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [refresh]);
  return { data, loadError, refresh };
}

export default function TrackerApp() {
  return (
    <ToastProvider>
      <Tracker />
    </ToastProvider>
  );
}

function Tracker() {
  const toast = useToast();
  const { data, loadError, refresh } = useSheet();
  const isPhone = useIsPhone();
  const [f, setF] = useState<Filters>(() => readUrl());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<MediaSummary | null>(null);
  const [confirmRowDel, setConfirmRowDel] = useState<Row | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const uploads = useUploads({ maxMb: data?.maxUploadMb ?? 100, onDone: () => void refresh(true), toast });

  useEffect(() => {
    const h = () => setF(readUrl());
    window.addEventListener('popstate', h);
    if (new URLSearchParams(window.location.search).get('pw') === 'changed') {
      toast('Password changed.');
      const nf = readUrl();
      writeUrl(nf, false);
    }
    return () => window.removeEventListener('popstate', h);
  }, [toast]);

  const update = useCallback((p: Partial<Filters>, push = false) => {
    setF((cur) => {
      const n = { ...cur, ...p };
      writeUrl(n, push);
      return n;
    });
  }, []);

  const me = data?.me;
  const canEdit = me?.role === 'editor' || me?.role === 'admin';
  const isAdmin = me?.role === 'admin';
  const effectiveStatus = f.status || DEFAULT_STATUS;

  const rows = useMemo(() => {
    if (!data) return [];
    const openStatuses = data.openStatuses;
    const q = f.q.trim().toLowerCase();
    let r = data.rows.filter((x) => {
      if (effectiveStatus === 'open' && !openStatuses.includes(x.status)) return false;
      if (effectiveStatus === 'active' && !ACTIVE_STATUSES.includes(x.status)) return false;
      if (effectiveStatus === 'Other' && STATUS_ORDER.includes(x.status)) return false;
      if (!['all', 'open', 'active', 'Other'].includes(effectiveStatus) && x.status !== effectiveStatus) return false;
      if (f.priority && x.priority !== f.priority) return false;
      if (f.owner === '-' && x.ownerRaw.trim()) return false;
      if (f.owner && f.owner !== '-' && x.owner !== f.owner) return false;
      if (q) {
        const hay = [x.title, x.notes, x.reporter, x.reporterRaw, x.owner, x.ownerRaw, x.status, x.priority, x.reportedDate, x.endDate, x.milestone, x.deliverable, ...x.media.map((m) => `${m.name} ${m.caption ?? ''}`)].join('\n').toLowerCase();
        if (!hay.includes(q) && String(x.rowNumber) !== q.replace(/^row\s*/, '')) return false;
      }
      return true;
    });
    if (f.newest) r = [...r].reverse();
    return r;
  }, [data, f, effectiveStatus]);

  const panelRow = data && f.row ? (data.rows.find((r) => r.rowNumber === f.row) ?? null) : null;
  const previewIdx = panelRow && f.media ? panelRow.media.findIndex((m) => m.fileId === f.media) : -1;

  useEffect(() => {
    if (highlight == null) return;
    const el = document.querySelector(`[data-row="${highlight}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [highlight, data?.version]);

  async function edit(row: Row, changes: Record<string, string>) {
    const field = Object.keys(changes)[0];
    const key = `${row.rowNumber}:${field}`;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const r = await api<{ row: Row; movedFrom?: number; changed: { field: string; from: string; to: string }[] }>('PATCH', `/api/rows/${row.rowNumber}`, { rowKey: row.rowKey, changes });
      const n = r.row?.rowNumber ?? row.rowNumber;
      if (r.changed.length) toast(`Row ${n}: ${r.changed.map((c) => `${c.field} → ${c.to || '(blank)'}`).join(', ')}`);
      if (r.movedFrom) toast(`Row moved: ${r.movedFrom} → ${n}`);
      if (f.row === row.rowNumber && n !== row.rowNumber) update({ row: n });
      await refresh(true);
    } catch (e) {
      toast((e as Error).message, true);
      if ((e as { status?: number }).status === 409) await refresh(true);
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[key];
        return n;
      });
    }
  }

  async function doDelete(m: MediaSummary) {
    try {
      await api('DELETE', `/api/media/${m.fileId}`);
      toast(data?.sync.mode === 'google' ? `${m.name} moved to Google Drive trash.` : `${m.name} deleted.`);
      if (f.media === m.fileId) {
        const list = panelRow?.media.filter((x) => x.fileId !== m.fileId) ?? [];
        update({ media: list.length ? list[Math.min(previewIdx, list.length - 1)].fileId : null });
      }
      await refresh(true);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setConfirmDel(null);
    }
  }

  async function doDeleteRow(r: Row) {
    try {
      const res = await api<{ deleted: number; mediaRemoved: number }>('DELETE', `/api/rows/${r.rowNumber}`, { rowKey: r.rowKey });
      toast(`Row ${res.deleted} deleted${res.mediaRemoved ? ` with ${res.mediaRemoved} file${res.mediaRemoved > 1 ? 's' : ''}` : ''}.`);
      if (f.row) update({ row: null, media: null });
      await refresh(true);
    } catch (e) {
      toast((e as Error).message, true);
      if ((e as { status?: number }).status === 409) await refresh(true);
    } finally {
      setConfirmRowDel(null);
    }
  }

  async function saveCaption(m: MediaSummary, caption: string) {
    try {
      await api('PATCH', `/api/media/${m.fileId}`, { caption });
      toast('Caption saved.');
      await refresh(true);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const canDelete = (m: MediaSummary) => !!canEdit && (isAdmin || m.uploaderUsername === me?.username);

  if (!data)
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          {loadError ? (
            <>
              <p className="danger-text">{loadError}</p>
              <button className="btn" onClick={() => void refresh(true)}>
                Try again
              </button>
            </>
          ) : (
            <p className="muted">Loading the sheet…</p>
          )}
        </div>
      </div>
    );

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${data.sheetId}/edit${data.sheetGid != null ? `#gid=${data.sheetGid}` : ''}`;
  const google = data.sync.mode === 'google';
  const rowLink = (n: number) => `https://docs.google.com/spreadsheets/d/${data.sheetId}/edit#gid=${data.sheetGid ?? 0}&range=A${n}`;
  const openRow = (n: number) => update({ row: n, media: null }, true);
  const openMedia = (row: Row, m: MediaSummary) => update({ row: row.rowNumber, media: m.fileId }, true);
  const peopleNames = data.people.filter((p) => p.active).map((p) => p.name);

  return (
    <>
      <Header data={data} sheetUrl={sheetUrl} canEdit={!!canEdit} onAdd={() => setAddOpen(true)} />
      {data.sync.demo && <div className="demo-banner">Demo mode: changes are kept in memory only and are lost when the server restarts.</div>}
      <main className="page">
        {isPhone ? (
          <PhoneView
            data={data}
            rows={rows}
            status={effectiveStatus}
            setStatus={(s) => update({ status: s })}
            onOpen={openRow}
            onMedia={openMedia}
            canEdit={!!canEdit}
            onAttach={(r) => openRow(r.rowNumber)}
          />
        ) : (
          <>
            <ProgressCards data={data} status={effectiveStatus} setStatus={(s) => update({ status: s === effectiveStatus ? 'all' : s })} />
            <Toolbar data={data} f={f} status={effectiveStatus} update={update} peopleNames={peopleNames} />
            <SheetTable
              data={data}
              rows={rows}
              canEdit={!!canEdit}
              busy={busy}
              highlight={highlight}
              onOpen={openRow}
              onMedia={openMedia}
              onEdit={edit}
              onDelete={(r) => setConfirmRowDel(r)}
            />
          </>
        )}
      </main>
      {panelRow && (
        <RowPanel
          row={panelRow}
          people={data.people}
          meName={data.me.name}
          canEdit={!!canEdit}
          isAdmin={!!isAdmin}
          sheetLink={rowLink(panelRow.rowNumber)}
          google={google}
          onDeleteRow={!google && canEdit ? () => setConfirmRowDel(panelRow) : undefined}
          uploads={uploads}
          busy={busy}
          onClose={() => update({ row: null, media: null })}
          onEdit={edit}
          onOpenMedia={(m) => openMedia(panelRow, m)}
          onDelete={(m) => setConfirmDel(m)}
          canDelete={canDelete}
          maxMb={data.maxUploadMb}
          rootFolderName="SMPRD Media"
        />
      )}
      {panelRow && previewIdx >= 0 && (
        <Preview
          row={panelRow}
          media={panelRow.media}
          index={previewIdx}
          onIndex={(i) => update({ media: panelRow.media[i].fileId })}
          onClose={() => update({ media: null })}
          canEdit={!!canEdit}
          canDelete={canDelete}
          isAdmin={!!isAdmin && google}
          onDelete={(m) => setConfirmDel(m)}
          onCaption={saveCaption}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="Delete file"
          message={google ? `Move ${confirmDel.name} to Google Drive trash? You can restore it from Drive for 30 days.` : `Delete ${confirmDel.name}? This cannot be undone.`}
          confirmLabel={google ? 'Move to trash' : 'Delete'}
          danger
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => doDelete(confirmDel)}
        />
      )}
      {confirmRowDel && (
        <ConfirmDialog
          title={`Delete row ${confirmRowDel.rowNumber}`}
          message={`Delete “${confirmRowDel.title.slice(0, 120)}”${confirmRowDel.media.length ? ` and its ${confirmRowDel.media.length} photo/video file${confirmRowDel.media.length > 1 ? 's' : ''}` : ''}? Rows below move up by one. The deletion is recorded in the Activity log. This cannot be undone.`}
          confirmLabel="Delete row"
          danger
          onCancel={() => setConfirmRowDel(null)}
          onConfirm={() => doDeleteRow(confirmRowDel)}
        />
      )}
      {addOpen && (
        <AddRowDialog
          data={data}
          onClose={() => setAddOpen(false)}
          onAdded={async (n, rowKey, files) => {
            setAddOpen(false);
            toast(`Row ${n} added${files.length ? ` – uploading ${files.length} file${files.length > 1 ? 's' : ''}` : ''}.`);
            if (files.length) uploads.addFiles({ rowNumber: n, rowKey }, files);
            update({ status: 'all', owner: '', priority: '', q: '' });
            await refresh(true);
            setHighlight(n);
            if (files.length) update({ row: n, media: null }, true);
          }}
        />
      )}
    </>
  );
}

// ---------------- header ----------------
function SyncLine({ data, short }: { data: SheetPayload; short?: boolean }) {
  if (data.sync.mode === 'google' && !data.sync.googleConnected)
    return (
      <div className="sync-line">
        <span className="bad">Google not connected</span>
        {data.me.role === 'admin' && <a href="/admin">Connect in Admin</a>}
      </div>
    );
  if (!data.sync.ok)
    return (
      <div className="sync-line">
        <span className="warn" title={data.sync.error ?? ''}>
          <AlertTriangle className="icon" style={{ width: 13, height: 13, verticalAlign: -2 }} /> Sync paused – retrying
        </span>
      </div>
    );
  return (
    <div className="sync-line">
      <span className="ok">
        <Check className="icon" style={{ width: 13, height: 13 }} /> {data.sync.mode === 'google' ? 'Synced with Google Sheets' : 'All changes saved'}
      </span>
      {!short && (
        <>
          {data.sync.mode === 'google' && <span>· Sheet1</span>}
          <span>· Last activity: {prettyDate(data.lastActivity) || '—'}</span>
        </>
      )}
    </div>
  );
}

function AccountMenu({ data }: { data: SheetPayload }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    window.location.href = '/login';
  }
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        <User className="icon" />
        <span className="desktop-only">{data.me.displayName}</span>
        <ChevronDown className="icon" />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="who">
            <strong>{data.me.displayName}</strong>
            {data.me.username} · {data.me.role}
          </div>
          {data.me.role === 'admin' && (
            <a href="/admin" role="menuitem">
              <Settings className="icon" /> Admin
            </a>
          )}
          <a href="/activity" role="menuitem">
            <History className="icon" /> Activity log
          </a>
          <a href="/account/password" role="menuitem">
            <KeyRound className="icon" /> Change password
          </a>
          <button type="button" role="menuitem" onClick={signOut}>
            <LogOut className="icon" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Header({ data, sheetUrl, canEdit, onAdd }: { data: SheetPayload; sheetUrl: string; canEdit: boolean; onAdd: () => void }) {
  return (
    <header className="header">
      <div className="brand">
        <AppIcon />
        <div style={{ minWidth: 0 }}>
          <h1>EPM DEV TRACKER</h1>
          <span className="desktop-only">
            <SyncLine data={data} />
          </span>
          <span className="phone-only">
            <SyncLine data={data} short />
          </span>
        </div>
      </div>
      <div className="actions">
        {data.sync.mode === 'google' ? (
          <a className="btn desktop-only" href={sheetUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="icon" /> Open in Google Sheets
          </a>
        ) : (
          <a className="btn desktop-only" href="/api/export" download>
            <Download className="icon" /> Export CSV
          </a>
        )}
        {canEdit && (
          <>
            <button type="button" className="btn primary desktop-only" onClick={onAdd}>
              <Plus className="icon" /> Add row
            </button>
            <button type="button" className="round-add phone-only" onClick={onAdd} aria-label="Add row">
              <Plus />
            </button>
          </>
        )}
        <AccountMenu data={data} />
      </div>
    </header>
  );
}

// ---------------- progress cards ----------------
function ProgressCards({ data, status, setStatus }: { data: SheetPayload; status: string; setStatus: (s: string) => void }) {
  const s = data.stats;
  const segs = [...STATUS_ORDER.map((k) => ({ k, n: s.byStatus[k] ?? 0 })), { k: 'Other', n: s.other }];
  const ip = s.inProgress;
  const highOpen = (s.byPriority.High?.total ?? 0) - (s.byPriority.High?.done ?? 0);
  const openMax = Math.max(1, ...Object.values(s.openBreakdown));
  const rowsText = (ns: number[]) => {
    if (!ns.length) return '';
    const sorted = [...ns].sort((a, b) => a - b);
    const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    return contiguous && sorted.length > 2 ? `Rows ${sorted[0]}–${sorted[sorted.length - 1]}` : `Row${sorted.length > 1 ? 's' : ''} ${sorted.join(', ')}`;
  };
  return (
    <section className="cards" aria-label="Progress">
      <div className="card wide">
        <div className="card-label">Overall progress</div>
        <div className="big-row">
          <span className="big">{s.completedPct}%</span>
          <span className="muted">
            {s.completed} of {s.total} completed
          </span>
        </div>
        <div className="segbar" role="img" aria-label={segs.map((x) => `${x.k} ${x.n}`).join(', ')}>
          {segs.map((x) => (x.n ? <span key={x.k} style={{ width: `${(x.n / Math.max(1, s.total)) * 100}%`, background: STATUS_STYLE[x.k]?.bar ?? STATUS_STYLE.Other.bar }} /> : null))}
        </div>
        <div className="legend">
          {segs
            .filter((x) => x.k !== 'Other' || x.n)
            .map((x) => (
              <button type="button" key={x.k} className={status === x.k ? 'active' : ''} onClick={() => setStatus(x.k)} aria-pressed={status === x.k}>
                <span className="dot" style={{ background: STATUS_STYLE[x.k]?.bar ?? STATUS_STYLE.Other.bar }} />
                <span className="lbl">{x.k}</span>
                <span className="cnt">{x.n}</span>
              </button>
            ))}
        </div>
      </div>
      <div className="card">
        <div className="card-label">Still open</div>
        <div className="big" style={{ marginBottom: 10 }}>
          {s.open}
        </div>
        <div className="mini-bars">
          {Object.entries(s.openBreakdown).map(([k, n]) => (
            <div className="mini-bar" key={k}>
              <span>{statusLabel(k)}</span>
              <span className="track">
                <span className="fill" style={{ display: 'block', width: `${(n / openMax) * 100}%`, background: STATUS_STYLE[k]?.bar ?? '#A3ABB7' }} />
              </span>
              <span className="n">{n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-label">In progress</div>
        <div className="big" style={{ marginBottom: 6 }}>
          {ip.count}
        </div>
        {ip.stalledRows.length > 0 && ip.oldestActivity && (
          <div className="stall" role="note">
            <AlertTriangle className="icon" style={{ width: 14, height: 14, marginTop: 1 }} />
            <span>
              No update since {prettyDate(ip.oldestActivity)}, {ip.oldestDays} days ago
            </span>
          </div>
        )}
        {ip.count > 0 && (
          <div className="card-foot" style={{ marginTop: 2 }}>
            {rowsText(ip.rows)}
            {ip.blankOwnerRows.length > 0 && (ip.blankOwnerRows.length === ip.count ? ' · Change owner is blank' : ` · ${rowsText(ip.blankOwnerRows)} ${ip.blankOwnerRows.length === 1 ? 'has' : 'have'} no Change owner`)}
          </div>
        )}
        {ip.count === 0 && <div className="card-foot">Nothing in progress.</div>}
      </div>
      <div className="card">
        <div className="card-label">Completed by priority</div>
        <div className="mini-bars" style={{ marginTop: 8 }}>
          {['High', 'Medium', 'Low'].map((p) => {
            const v = s.byPriority[p] ?? { done: 0, total: 0 };
            return (
              <div className="mini-bar" key={p} style={{ gridTemplateColumns: '60px 1fr 46px' }}>
                <span>{p}</span>
                <span className="track">
                  <span className="fill" style={{ display: 'block', width: `${v.total ? (v.done / v.total) * 100 : 0}%`, background: '#2E9E63' }} />
                </span>
                <span className="n">
                  {v.done}/{v.total}
                </span>
              </div>
            );
          })}
        </div>
        <div className={`card-foot${highOpen > 0 ? ' bad' : ''}`}>{highOpen > 0 ? `${highOpen} High item${highOpen > 1 ? 's' : ''} still open` : `All ${s.byPriority.High?.total ?? 0} High items are done`}</div>
      </div>
      <div className="card">
        <div className="card-label">Photos &amp; videos</div>
        <div className="big-row" style={{ marginBottom: 4 }}>
          <span className="big">{s.media.rows}</span>
          <span className="muted">{s.media.rows === 1 ? 'row' : 'rows'} with media</span>
        </div>
        <div className="thumb-stack">
          {s.media.latestThumbs.length ? (
            s.media.latestThumbs.map((id) => (
               
              <img key={id} src={`/api/media/${id}/thumb`} alt="" />
            ))
          ) : (
            <>
              <span className="ph" />
              <span className="ph" />
              <span className="ph" />
            </>
          )}
        </div>
        <div className="card-foot">
          {s.media.photos} photo{s.media.photos === 1 ? '' : 's'} · {s.media.videos} video{s.media.videos === 1 ? '' : 's'} {data.sync.mode === 'google' ? ' · in Google Drive' : ''}
        </div>
      </div>
    </section>
  );
}

// ---------------- toolbar ----------------
const CHIP_LIST: { v: string; label: string }[] = [
  { v: 'active', label: 'In progress + TBD' },
  { v: 'all', label: 'All' },
  { v: 'Completed', label: 'Completed' },
  { v: 'In progress', label: 'In progress' },
  { v: 'Feature is Coming soon', label: 'Coming soon' },
  { v: 'TBD', label: 'TBD' },
  { v: 'Feature existing', label: 'Feature existing' },
  { v: 'Feature not needed', label: 'Not needed' },
];

function chipCount(data: SheetPayload, v: string) {
  if (v === 'all') return data.stats.total;
  if (v === 'open') return data.stats.open;
  if (v === 'active') return ACTIVE_STATUSES.reduce((a, k) => a + (data.stats.byStatus[k] ?? 0), 0);
  if (v === 'Other') return data.stats.other;
  return data.stats.byStatus[v] ?? 0;
}

function Toolbar({ data, f, status, update, peopleNames }: { data: SheetPayload; f: Filters; status: string; update: (p: Partial<Filters>) => void; peopleNames: string[] }) {
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && update({ q }), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = data.stats.other ? [...CHIP_LIST, { v: 'Other', label: 'Other' }] : CHIP_LIST;
  return (
    <div className="toolbar">
      <div className="chips" role="group" aria-label="Status filter">
        {chips.map((c) => (
          <button type="button" key={c.v} className={`fchip${status === c.v ? ' on' : ''}`} aria-pressed={status === c.v} onClick={() => update({ status: c.v === DEFAULT_STATUS ? '' : c.v })}>
            {c.label} <span className="n">{chipCount(data, c.v)}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <label className="search">
        <Search className="icon" />
        <span className="sr-only">Search rows</span>
        <input className="input" type="search" placeholder="Search any name or text" value={q} onChange={(e) => setQ(e.target.value)} list="search-suggest" />
        <datalist id="search-suggest">
          {[...new Set([...data.people.filter((p) => p.active).map((p) => p.name), ...data.rows.flatMap((r) => [r.reporter, r.owner]).filter(Boolean)])].sort().map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>
      <label>
        <span className="sr-only">Change owner</span>
        <select className="input" value={f.owner} onChange={(e) => update({ owner: e.target.value })} aria-label="Change owner">
          <option value="">Change owner: Anyone</option>
          {peopleNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="-">No owner</option>
        </select>
      </label>
      <label>
        <span className="sr-only">Priority</span>
        <select className="input" value={f.priority} onChange={(e) => update({ priority: e.target.value })} aria-label="Priority">
          <option value="">Priority: Any</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={`fchip${f.newest ? ' on' : ''}`} aria-pressed={f.newest} onClick={() => update({ newest: !f.newest })}>
        Newest first
      </button>
    </div>
  );
}

// ---------------- table ----------------
const COLS: { letter: string; name: string; w: number; isNew?: boolean }[] = [
  { letter: 'A', name: 'Change Request', w: 256 },
  { letter: 'B', name: 'Priority', w: 92 },
  { letter: 'C', name: 'Reported By', w: 104 },
  { letter: 'D', name: 'Status', w: 186 },
  { letter: 'E', name: 'Reported Date', w: 98 },
  { letter: 'F', name: 'End date', w: 96 },
  { letter: 'G', name: 'Milestone', w: 86 },
  { letter: 'H', name: 'Change owner', w: 112 },
  { letter: 'I', name: 'Deliverable', w: 90 },
  { letter: 'J', name: 'Notes', w: 150 },
  { letter: 'K', name: 'Media', w: 178, isNew: true },
];

function MediaThumb({ m, onClick, size }: { m: MediaSummary; onClick: () => void; size?: number }) {
  return (
    <button type="button" className="mthumb" onClick={onClick} aria-label={`Preview ${m.name}`} style={size ? { width: size, height: size } : undefined}>
      {m.hasThumb ? (
         
        <img src={`/api/media/${m.fileId}/thumb`} alt="" loading="lazy" />
      ) : m.kind === 'video' ? (
        <Video className="icon" />
      ) : (
        <ImageIcon className="icon" />
      )}
      {m.kind === 'video' && m.hasThumb && (
        <span className="play">
          <Play fill="currentColor" />
        </span>
      )}
    </button>
  );
}

function SheetTable({
  data,
  rows,
  canEdit,
  busy,
  highlight,
  onOpen,
  onMedia,
  onEdit,
  onDelete,
}: {
  data: SheetPayload;
  rows: Row[];
  canEdit: boolean;
  busy: Record<string, boolean>;
  highlight: number | null;
  onOpen: (n: number) => void;
  onMedia: (r: Row, m: MediaSummary) => void;
  onEdit: (r: Row, c: Record<string, string>) => void;
  onDelete: (r: Row) => void;
}) {
  const [cf, setCf] = useState<Record<string, string>>({});
  const standalone = data.sync.mode !== 'google';
  const textEdit = canEdit && standalone;
  const allRows = rows;
  rows = useMemo(() => filterByColumns(allRows, cf), [allRows, cf]);
  const anyFilter = Object.values(cf).some(Boolean);
  const names = useMemo(() => [...new Set(allRows.flatMap((r) => [r.reporter, r.owner]).filter(Boolean))].sort(), [allRows]);
  const statuses = useMemo(() => [...new Set(allRows.map((r) => r.status).filter(Boolean))].sort(), [allRows]);
  const OLD: Record<string, string> = { 'Change Request': 'Bugs', 'Change owner': 'Bug Owner' };
  const tip = (r: Row, field: string) => {
    const e = r.edits?.[field] ?? (OLD[field] ? r.edits?.[OLD[field]] : undefined);
    return e ? `Last edited by ${e.by} · ${e.at}` : undefined;
  };
  const nums = rows.map((r) => r.rowNumber);
  const a = nums.length ? Math.min(...nums) : 0;
  const b = nums.length ? Math.max(...nums) : 0;
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table className="sheet">
          <colgroup>
            <col style={{ width: 44 }} />
            {COLS.map((c) => (
              <col key={c.letter} style={{ width: c.w }} />
            ))}
          </colgroup>
          <thead>
            <tr className="names">
              <th className="rn" scope="col">
                {anyFilter ? (
                  <button type="button" className="clear-filters" onClick={() => setCf({})} aria-label="Clear column filters" title="Clear all column filters">
                    <X className="icon" />
                  </button>
                ) : (
                  '1'
                )}
              </th>
              {COLS.map((c) => {
                const v = cf[c.letter] ?? '';
                const set = (nv: string) => setCf((f) => ({ ...f, [c.letter]: nv }));
                const options =
                  c.letter === 'B'
                    ? PRIORITIES.map((p) => ({ v: p, l: p }))
                    : c.letter === 'D'
                      ? statuses.map((x) => ({ v: x, l: statusLabel(x) }))
                      : c.letter === 'C' || c.letter === 'H'
                        ? [...(c.letter === 'H' ? [{ v: '-', l: 'No owner' }] : []), ...names.map((n) => ({ v: n, l: n }))]
                        : c.letter === 'K'
                          ? [
                              { v: 'yes', l: 'Has media' },
                              { v: 'no', l: 'No media' },
                            ]
                          : null;
                return (
                  <th key={c.letter} scope="col" className={v ? 'filtered' : undefined}>
                    <div className="th-inner">
                      <span className="th-name">
                        {c.name}
                        {c.isNew && <span className="new-badge">New</span>}
                      </span>
                      <HeaderFilter name={c.name} value={v} onChange={set} options={options} placeholder={c.letter === 'E' || c.letter === 'F' ? 'dd/mm/yyyy' : 'Contains…'} />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.rowNumber}-${r.rowKey}`} data-row={r.rowNumber} className={highlight === r.rowNumber ? 'hl' : ''}>
                <th className="rn" scope="row">
                  {r.rowNumber}
                  {textEdit && (
                    <button type="button" className="row-del" onClick={() => onDelete(r)} aria-label={`Delete row ${r.rowNumber}`} title="Delete row">
                      <Trash2 className="icon" />
                    </button>
                  )}
                  {r.duplicate && (
                    <div>
                      <span className="dup" title="Possible duplicate: another row has the same date and text. Edits are blocked until one is changed in Sheets.">
                        dup
                      </span>
                    </div>
                  )}
                </th>
                <td title={tip(r, 'Change Request')}>
                  <button type="button" className="cell-title clamp2" onClick={() => onOpen(r.rowNumber)} title={r.title}>
                    {r.title}
                  </button>
                </td>
                <td title={tip(r, 'Priority')}>
                  <ChipSelect label={`Row ${r.rowNumber} priority`} value={r.priority} options={PRIORITIES} disabled={!canEdit} busy={busy[`${r.rowNumber}:priority`]} onChange={(v) => onEdit(r, { priority: v })} render={(v, o) => <PriorityChip priority={v} caret={o.caret} busy={o.busy} />} />
                </td>
                <td title={tip(r, 'Reported By')}>
                  <NamePicker label={`Row ${r.rowNumber} Reported By`} value={r.reporter} raw={r.reporterRaw} known={r.reporterKnown} people={data.people} meName={data.me.name} placeholder="+ Add name" disabled={!canEdit} busy={busy[`${r.rowNumber}:reporter`]} onChoose={(n) => onEdit(r, { reporter: n })} />
                </td>
                <td title={tip(r, 'Status')}>
                  <ChipSelect label={`Row ${r.rowNumber} status`} value={r.status} options={STATUS_EDIT_ORDER} disabled={!canEdit} busy={busy[`${r.rowNumber}:status`]} onChange={(v) => onEdit(r, { status: v })} render={(v, o) => <StatusChip status={v} caret={o.caret} busy={o.busy} />} />
                </td>
                <EditableCell kind="date" value={r.reportedDate} label={`Row ${r.rowNumber} Reported Date`} disabled={!textEdit} busy={busy[`${r.rowNumber}:reportedDate`]} title={tip(r, 'Reported Date')} onSave={(v) => onEdit(r, { reportedDate: v })} />
                <EditableCell kind="date" value={r.endDate} label={`Row ${r.rowNumber} End date`} disabled={!textEdit} busy={busy[`${r.rowNumber}:endDate`]} title={tip(r, 'End date')} onSave={(v) => onEdit(r, { endDate: v })} />
                <EditableCell kind="text" value={r.milestone} label={`Row ${r.rowNumber} Milestone`} disabled={!textEdit} busy={busy[`${r.rowNumber}:milestone`]} title={tip(r, 'Milestone')} onSave={(v) => onEdit(r, { milestone: v })} />
                <td title={tip(r, 'Change owner')}>
                  <NamePicker label={`Row ${r.rowNumber} Change owner`} value={r.owner} raw={r.ownerRaw} known={r.ownerKnown} people={data.people} meName={data.me.name} allowNone placeholder="+ Add owner" disabled={!canEdit} busy={busy[`${r.rowNumber}:owner`]} onChoose={(n) => onEdit(r, { owner: n })} />
                </td>
                <EditableCell kind="text" value={r.deliverable} label={`Row ${r.rowNumber} Deliverable`} disabled={!textEdit} busy={busy[`${r.rowNumber}:deliverable`]} title={tip(r, 'Deliverable')} onSave={(v) => onEdit(r, { deliverable: v })} />
                <EditableCell kind="long" className="notes" value={r.notes} label={`Row ${r.rowNumber} Notes`} disabled={!textEdit} busy={busy[`${r.rowNumber}:notes`]} title={tip(r, 'Notes') ?? r.notes} onSave={(v) => onEdit(r, { notes: v })} />
                <td>
                  <div className="media-cell">
                    {r.media.length ? (
                      <>
                        {r.media.slice(0, 3).map((m) => (
                          <MediaThumb key={m.fileId} m={m} onClick={() => onMedia(r, m)} />
                        ))}
                        {r.media.length > 3 && <span className="more">+{r.media.length - 3}</span>}
                        <button type="button" className="icon-btn plain" style={{ width: 28, height: 28 }} onClick={() => onOpen(r.rowNumber)} aria-label={`Photos and videos for row ${r.rowNumber}`}>
                          <Paperclip className="icon" />
                        </button>
                      </>
                    ) : canEdit ? (
                      <button type="button" className="attach-btn" onClick={() => onOpen(r.rowNumber)} aria-label={`Attach photos or videos to row ${r.rowNumber}`}>
                        <Paperclip className="icon" style={{ width: 13, height: 13 }} /> Attach
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{data.rows.length ? `No rows match these filters.${anyFilter ? ' Clear the column filters with ✕ at the top left.' : ''}` : data.sync.googleConnected ? (data.me.role === 'admin' && data.sync.mode !== 'google' ? 'No rows yet. Use “Add row”, or import your existing sheet as CSV in Admin → Data.' : 'No rows yet.') : 'Google is not connected yet, so there is no sheet to show.'}</div>}
      </div>
      <div className="table-foot">
        <span>
          {rows.length ? `Showing rows ${a}–${b} of ${data.stats.total}${rows.length !== data.stats.total ? ` (${rows.length} match)` : ''}` : `0 of ${data.stats.total} rows`} · same columns and order as the original sheet, plus Media
        </span>
        <span>{data.sync.mode === 'google' ? 'Edits here write back to Sheet1 · files are stored in Google Drive' : 'Saved in the tracker database · files are stored on the server'}</span>
      </div>
    </div>
  );
}

function filterByColumns(rows: Row[], cf: Record<string, string>): Row[] {
  const active = Object.entries(cf).filter(([, v]) => v);
  if (!active.length) return rows;
  const has = (hay: string, n: string) => hay.toLowerCase().includes(n.trim().toLowerCase());
  return rows.filter((r) =>
    active.every(([col, v]) => {
      switch (col) {
        case 'A': return has(r.title, v);
        case 'B': return r.priority === v;
        case 'C': return r.reporter === v;
        case 'D': return r.status === v;
        case 'E': return has(r.reportedDate, v);
        case 'F': return has(r.endDate, v);
        case 'G': return has(r.milestone, v);
        case 'H': return v === '-' ? !r.ownerRaw.trim() : r.owner === v;
        case 'I': return has(r.deliverable, v);
        case 'J': return has(r.notes, v);
        case 'K': return v === 'yes' ? r.media.length > 0 : r.media.length === 0;
        default: return true;
      }
    }),
  );
}

/** Filter button inside a column header (row 1), like a spreadsheet's AutoFilter. */
function HeaderFilter({ name, value, onChange, options, placeholder }: { name: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] | null; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const label = options ? options.find((o) => o.v === value)?.l : value;
  return (
    <div className="hf" ref={ref}>
      <button
        type="button"
        className={`hf-btn${value ? ' on' : ''}`}
        aria-label={`Filter column ${name}`}
        aria-expanded={open}
        title={value ? `Filtered: ${label}` : `Filter ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Filter className="icon" />
      </button>
      {open && (
        <div className="hf-pop" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {options ? (
            <select
              className="col-filter"
              autoFocus
              value={value}
              aria-label={`Filter ${name}`}
              onChange={(e) => {
                onChange(e.target.value);
                setOpen(false);
              }}
            >
              <option value="">All</option>
              {options.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          ) : (
            <input className="col-filter" autoFocus value={value} placeholder={placeholder} aria-label={`Filter ${name}`} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setOpen(false)} />
          )}
          {value && (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A table cell you can click to edit in place. Enter saves, Esc cancels, clicking away saves. */
function EditableCell({ value, onSave, kind, label, disabled, busy, title, className }: { value: string; onSave: (v: string) => void; kind: 'text' | 'date' | 'long'; label: string; disabled?: boolean; busy?: boolean; title?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const cls = `${className ?? ''}${kind === 'date' ? ' mono' : ''}`;
  const done = (save: boolean) => {
    setEditing(false);
    if (save && v.trim() !== value.trim()) onSave(v.trim());
  };
  if (disabled)
    return (
      <td className={cls} style={kind === 'date' ? { fontSize: 12.5 } : undefined} title={title}>
        {kind === 'date' ? value : <span className="clamp2">{value}</span>}
      </td>
    );
  return (
    <td className={`${cls} editable${busy ? ' busy' : ''}`} style={kind === 'date' ? { fontSize: 12.5 } : undefined} title={editing ? undefined : title}>
      {editing ? (
        kind === 'long' ? (
          <textarea
            className="cell-input"
            autoFocus
            rows={3}
            value={v}
            onFocus={(e) => e.target.select()}
            aria-label={label}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => done(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setV(value); done(false); }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
            }}
          />
        ) : (
          <input
            className="cell-input"
            autoFocus
            type={kind === 'date' ? 'date' : 'text'}
            value={kind === 'date' ? isoFromUk(v) : v}
            aria-label={label}
            onFocus={(e) => {
              if (kind !== 'date') e.target.select();
            }}
            onChange={(e) => setV(kind === 'date' ? ukDate(e.target.value) : e.target.value)}
            onBlur={() => done(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setV(value); done(false); }
              if (e.key === 'Enter') { e.preventDefault(); done(true); }
            }}
          />
        )
      ) : (
        <button
          type="button"
          className="cell-edit"
          aria-label={`${label}: ${value || 'empty'}. Edit`}
          onClick={() => {
            setV(value);
            setEditing(true);
          }}
        >
          {busy ? <Loader2 className="icon spin" /> : value ? (kind === 'date' ? value : <span className="clamp2">{value}</span>) : <span className="cell-empty">+</span>}
        </button>
      )}
    </td>
  );
}

// ---------------- phone ----------------
function PhoneView({
  data,
  rows,
  status,
  setStatus,
  onOpen,
  onMedia,
  canEdit,
  onAttach,
}: {
  data: SheetPayload;
  rows: Row[];
  status: string;
  setStatus: (s: string) => void;
  onOpen: (n: number) => void;
  onMedia: (r: Row, m: MediaSummary) => void;
  canEdit: boolean;
  onAttach: (r: Row) => void;
}) {
  const s = data.stats;
  const segs = [...STATUS_ORDER.map((k) => ({ k, n: s.byStatus[k] ?? 0 })), { k: 'Other', n: s.other }];
  const chips = [{ v: 'open', label: 'Open' }, ...CHIP_LIST, ...(s.other ? [{ v: 'Other', label: 'Other' }] : [])];
  return (
    <>
      <section className="phone-progress" aria-label="Progress">
        <div className="big-row" style={{ marginBottom: 8 }}>
          <span className="big">{s.completedPct}%</span>
          <span className="muted">
            {s.completed} of {s.total} completed
          </span>
        </div>
        <div className="segbar">{segs.map((x) => (x.n ? <span key={x.k} style={{ width: `${(x.n / Math.max(1, s.total)) * 100}%`, background: STATUS_STYLE[x.k]?.bar ?? STATUS_STYLE.Other.bar }} /> : null))}</div>
        <div className="stats3">
          <div>
            <div className="l">Open</div>
            <div className="v">{s.open}</div>
          </div>
          <div>
            <div className="l">Stalled</div>
            <div className={`v${s.inProgress.stalledRows.length ? ' red' : ''}`}>{s.inProgress.stalledRows.length}</div>
          </div>
          <div>
            <div className="l">Media</div>
            <div className="v">
              {s.media.rows} <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--muted)' }}>{s.media.rows === 1 ? 'row' : 'rows'}</span>
            </div>
          </div>
        </div>
      </section>
      <div className="chips scroll" role="group" aria-label="Status filter">
        {chips.map((c) => (
          <button type="button" key={c.v} className={`fchip${status === c.v ? ' on' : ''}`} aria-pressed={status === c.v} onClick={() => setStatus(c.v === 'all' ? 'all' : c.v)}>
            {c.label} <span className="n">{chipCount(data, c.v)}</span>
          </button>
        ))}
      </div>
      <div className="rcards">
        {rows.map((r) => (
          <article className="rcard" key={`${r.rowNumber}-${r.rowKey}`} data-row={r.rowNumber}>
            <div className="top">
              <span className="rn">Row {r.rowNumber}</span>
              <StatusChip status={r.status} />
              <PriorityChip priority={r.priority} />
            </div>
            <button type="button" className="tt" onClick={() => onOpen(r.rowNumber)}>
              {r.title}
            </button>
            <div className="sub">
              {r.reporter || '—'} · {r.reportedDate} · Owner: {r.owner ? r.owner : <span className="danger-text">No owner</span>}
            </div>
            {r.stalled && (
              <div className="stall" style={{ marginTop: 8 }}>
                <AlertTriangle className="icon" style={{ width: 14, height: 14 }} /> No update since {prettyDate(r.lastActivity)} · {r.stalledDays} days
              </div>
            )}
            <div className="strip2">
              {r.media.map((m) => (
                <MediaThumb key={m.fileId} m={m} onClick={() => onMedia(r, m)} size={56} />
              ))}
              {canEdit &&
                (r.media.length ? (
                  <button type="button" className="add-tile" onClick={() => onAttach(r)} aria-label={`Add photo or video to row ${r.rowNumber}`}>
                    <Camera className="icon" />
                    Add
                  </button>
                ) : (
                  <button type="button" className="add-tile wide" onClick={() => onAttach(r)}>
                    <Camera className="icon" /> Photo or video
                  </button>
                ))}
            </div>
          </article>
        ))}
        {!rows.length && <div className="empty">No rows here.</div>}
      </div>
    </>
  );
}

// ---------------- add row ----------------
function AddRowDialog({ data, onClose, onAdded }: { data: SheetPayload; onClose: () => void; onAdded: (n: number, rowKey: string, files: File[]) => void }) {
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // yyyy-mm-dd
  const [reportedDate, setReportedDate] = useState(todayIso);
  const [endDate, setEndDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileIn = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('TBD');
  const [reporter, setReporter] = useState(data.people.some((p) => p.name === data.me.name) ? data.me.name : '');
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ row: { rowNumber: number; rowKey: string } }>('POST', '/api/rows', { title, priority, status, reporter: reporter || data.me.name, owner, notes, reportedDate: ukDate(reportedDate), endDate: ukDate(endDate) });
      onAdded(r.row.rowNumber, r.row.rowKey, files);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add row" onClose={onClose}>
      <form onSubmit={submit}>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="ar-title">Change Request</label>
          <textarea id="ar-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={5000} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="ar-pri">Priority</label>
            <select id="ar-pri" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ar-st">Status</label>
            <select id="ar-st" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_EDIT_ORDER.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="two">
          <div className="field">
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Reported By</span>
            <NamePicker label="Reported By" inline={false} value={reporter} raw={reporter} known people={data.people} meName={data.me.name} onChoose={setReporter} emptyText={data.me.name} />
          </div>
          <div className="field">
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Change owner</span>
            <NamePicker label="Change owner" inline={false} value={owner} raw={owner} known people={data.people} meName={data.me.name} allowNone noneLabel="Decide later" onChoose={setOwner} emptyText="Decide later" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ar-notes">Notes</label>
          <textarea id="ar-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="ar-rd">Reported Date</label>
            <input id="ar-rd" className="input" type="date" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="ar-ed">End date</label>
            <input id="ar-ed" className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Screenshots, photos or videos</span>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <button type="button" className="btn small" onClick={() => fileIn.current?.click()}>
              <Paperclip className="icon" /> Add screenshot
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {files.length ? `${files.length} file${files.length > 1 ? 's' : ''}: ${files.map((f) => f.name).join(', ')}` : 'JPG, PNG, HEIC, MP4 or MOV'}
            </span>
            {files.length > 0 && (
              <button type="button" className="btn small ghost" onClick={() => setFiles([])}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileIn}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov"
            aria-label="Screenshots"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []); // read before clearing the input
              setFiles((f) => [...f, ...picked]);
              e.target.value = '';
            }}
          />
          <span className="hint">Uploaded to the new row as soon as it is saved.</span>
        </div>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
            {busy ? 'Adding…' : 'Add row'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
