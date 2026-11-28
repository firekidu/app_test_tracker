'use client';
import { Camera, Download, ExternalLink, History, Pencil, Folder, Image as ImageIcon, Loader2, RotateCcw, Trash2, Upload, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeLogEntry, MediaSummary, Person, Row } from '@/lib/types';
import { NamePicker } from './NamePicker';
import type { Uploads } from './useUploads';
import { ChipSelect, Dialog, isoFromUk, ukDate, PRIORITIES, PriorityChip, STATUS_EDIT_ORDER, StatusChip, api, fmtBytes, fmtDuration, prettyDate, trapTab } from './ui';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov';

function upLabel(s: string) {
  switch (s) {
    case 'waiting':
      return 'Waiting…';
    case 'queued':
    case 'uploading_to_drive':
      return 'Saving…';
    case 'processing':
      return 'Making preview…';
    case 'done':
      return 'Saved';
    default:
      return '';
  }
}

export default function RowPanel({
  row,
  people,
  meName,
  canEdit,
  isAdmin,
  sheetLink,
  uploads,
  busy,
  onClose,
  onEdit,
  onOpenMedia,
  onDelete,
  canDelete,
  maxMb,
  rootFolderName,
  google,
  onDeleteRow,
}: {
  row: Row;
  people: Person[];
  meName: string;
  canEdit: boolean;
  isAdmin: boolean;
  sheetLink: string;
  uploads: Uploads;
  busy: Record<string, boolean>;
  onClose: () => void;
  onEdit: (row: Row, changes: Record<string, string>) => void;
  onOpenMedia: (m: MediaSummary) => void;
  onDelete: (m: MediaSummary) => void;
  canDelete: (m: MediaSummary) => boolean;
  maxMb: number;
  rootFolderName: string;
  google: boolean;
  onDeleteRow?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [history, setHistory] = useState<ChangeLogEntry[] | null>(null);
  const mine = uploads.items.filter((u) => u.rowKey === row.rowKey && u.status !== 'done');

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button[aria-label="Close panel"]')?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    let live = true;
    api<ChangeLogEntry[]>('GET', `/api/rows/${row.rowNumber}/changes`)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [row.rowNumber, row.rowKey, row.status, row.priority, row.owner, row.reporter, row.endDate, row.milestone, row.deliverable, row.notes, row.media.length]);

  const addFiles = (files: FileList | null) => {
    if (files && files.length) uploads.addFiles({ rowNumber: row.rowNumber, rowKey: row.rowKey }, files);
  };
  const folderName = row.mediaFolderUrl ? `${row.reportedDate.split('/').reverse().join('-')} · ${row.title.slice(0, 50)}` : 'a new folder for this row';

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside
        className="panel"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Row ${row.rowNumber}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.dd')) onClose();
          if (e.key === 'Tab') trapTab(e, ref.current);
        }}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setOver(false);
        }}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="panel-head">
          <span className="mono muted" style={{ fontSize: 12.5 }}>
            Row {row.rowNumber} · Sheet1
          </span>
          <button type="button" className="icon-btn plain" onClick={onClose} aria-label="Close panel">
            <X className="icon" />
          </button>
        </div>
        <div className="panel-body">
          <h2>{row.title}</h2>
          <div className="chips-row">
            <ChipSelect label="Status" value={row.status} options={STATUS_EDIT_ORDER} disabled={!canEdit} busy={busy[`${row.rowNumber}:status`]} onChange={(v) => onEdit(row, { status: v })} render={(v, o) => <StatusChip status={v} caret={o.caret} busy={o.busy} />} />
            <ChipSelect label="Priority" value={row.priority} options={PRIORITIES} disabled={!canEdit} busy={busy[`${row.rowNumber}:priority`]} onChange={(v) => onEdit(row, { priority: v })} render={(v, o) => <PriorityChip priority={v} caret={o.caret} busy={o.busy} />} />
            {row.stalled && <span className="chip" style={{ color: '#B42318', background: '#FDE3E1' }}>No update for {row.stalledDays} days</span>}
          </div>
          <div className="meta">
            <span>
              Reported by{' '}
              <NamePicker label="Reported By" value={row.reporter} raw={row.reporterRaw} known={row.reporterKnown} people={people} meName={meName} disabled={!canEdit} busy={busy[`${row.rowNumber}:reporter`]} onChoose={(n) => onEdit(row, { reporter: n })} /> on {row.reportedDate || '—'}
            </span>
            <span>
              Change owner:{' '}
              <NamePicker label="Change owner" value={row.owner} raw={row.ownerRaw} known={row.ownerKnown} people={people} meName={meName} allowNone emptyText="No owner" placeholder="+ Add owner" disabled={!canEdit} busy={busy[`${row.rowNumber}:owner`]} onChoose={(n) => onEdit(row, { owner: n })} />
            </span>
            {row.endDate && <span>End date: {row.endDate}</span>}
            {row.milestone && <span>Milestone: {row.milestone}</span>}
            {row.deliverable && <span>Deliverable: {row.deliverable}</span>}
          </div>
          {row.notes && <div className="notes-box">{row.notes}</div>}
          <p style={{ margin: '10px 0 0', fontSize: 13 }}>
            {google ? (
              <a href={sheetLink} target="_blank" rel="noopener noreferrer">
                Edit this row in Google Sheets <ExternalLink className="icon" style={{ width: 13, height: 13, verticalAlign: -2 }} />
              </a>
            ) : canEdit ? (
              <span className="btn-row">
                <button type="button" className="btn small" onClick={() => setEditing(true)}>
                  <Pencil className="icon" /> Edit details
                </button>
                <a className="btn small ghost" href={`/activity?row=${row.rowNumber}`}>
                  <History className="icon" /> Activity
                </a>
                {onDeleteRow && (
                  <button type="button" className="btn small danger" onClick={onDeleteRow}>
                    <Trash2 className="icon" /> Delete row
                  </button>
                )}
              </span>
            ) : null}
          </p>
          {editing && <EditDetailsDialog row={row} onClose={() => setEditing(false)} onSave={(c) => { setEditing(false); onEdit(row, c); }} />}

          <h3>Photos &amp; videos ({row.media.length})</h3>
          {row.media.length > 0 ? (
            <div className="media-grid">
              {row.media.map((m) => (
                <div className="mcard" key={m.fileId}>
                  <button type="button" className="tb" onClick={() => onOpenMedia(m)} aria-label={`Open ${m.name}`}>
                    {m.hasThumb ? (
                       
                      <img src={`/api/media/${m.fileId}/thumb`} alt="" loading="lazy" />
                    ) : m.kind === 'video' ? (
                      <Video className="icon" />
                    ) : (
                      <ImageIcon className="icon" />
                    )}
                    {m.kind === 'video' && m.durationS != null && <span className="dur">{fmtDuration(m.durationS)}</span>}
                    {m.status !== 'ready' && <span className="status-tag">{m.status === 'processing' ? 'Processing…' : 'Preview failed'}</span>}
                  </button>
                  <div className="info">
                    <div className="nm" title={m.name}>
                      {m.kind === 'video' ? <Video /> : <ImageIcon />}
                      <span>{m.name}</span>
                    </div>
                    <div className="sz">
                      {fmtBytes(m.size)} · {prettyDate(m.createdAt)}
                    </div>
                  </div>
                  <div className="acts">
                    <a className="icon-btn" href={`/api/media/${m.fileId}/download`} aria-label={`Download ${m.name}`} title="Download">
                      <Download className="icon" />
                    </a>
                    {google && isAdmin && row.mediaFolderUrl && (
                      <a className="icon-btn" href={row.mediaFolderUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in Drive" title="Open in Drive">
                        <ExternalLink className="icon" />
                      </a>
                    )}
                    {canDelete(m) && (
                      <button type="button" className="icon-btn danger" onClick={() => onDelete(m)} aria-label={`Delete ${m.name}`} title="Delete">
                        <Trash2 className="icon" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No photos or videos yet.
            </p>
          )}

          {mine.length > 0 && (
            <div className="uploads-list" aria-live="polite">
              {mine.map((u) => {
                const pct = u.size ? Math.floor((u.bytesAcked / u.size) * 100) : 0;
                const failed = u.status === 'failed' || u.status === 'stopped';
                return (
                  <div key={u.localId} className={`up-item${failed ? ' failed' : ''}`}>
                    <div className="row1">
                      {u.type.startsWith('video') ? <Video className="icon" /> : <ImageIcon className="icon" />}
                      <span className="nm">{u.name}</span>
                      <span className="mono muted">{fmtBytes(u.size)}</span>
                      {u.status === 'sending' && <span className="mono">{pct}%</span>}
                      {['queued', 'uploading_to_drive', 'processing', 'waiting'].includes(u.status) && (
                        <span className="muted" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <Loader2 className="icon spin" /> {upLabel(u.status)}
                        </span>
                      )}
                      {u.status === 'stopped' && uploads.canRetry(u.localId) && (
                        <button type="button" className="btn small" onClick={() => uploads.retry(u.localId)}>
                          <RotateCcw className="icon" /> Retry
                        </button>
                      )}
                      {['sending', 'waiting', 'stopped'].includes(u.status) ? (
                        <button type="button" className="btn small ghost" onClick={() => uploads.cancel(u.localId)}>
                          Cancel
                        </button>
                      ) : failed ? (
                        <button type="button" className="icon-btn plain" style={{ width: 26, height: 26, minHeight: 26 }} aria-label="Dismiss" onClick={() => uploads.dismiss(u.localId)}>
                          <X className="icon" />
                        </button>
                      ) : null}
                    </div>
                    {u.status === 'sending' && (
                      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${u.name}`}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {u.error && <div className="err">{u.error}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {canEdit && (
            <div className={`dropzone${over ? ' over' : ''}`}>
              <Upload className="icon" style={{ width: 22, height: 22, color: 'var(--muted)' }} />
              <div className="t">Drop photos or videos here</div>
              <div className="btns">
                <button type="button" className="btn primary" onClick={() => fileIn.current?.click()}>
                  Choose files
                </button>
                <button type="button" className="btn" onClick={() => camIn.current?.click()}>
                  <Camera className="icon" /> Take photo or video
                </button>
              </div>
              <div className="help">JPG, PNG, HEIC, MP4 or MOV · up to {maxMb} MB each</div>
              <input ref={fileIn} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
              <input ref={camIn} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
            </div>
          )}
          <div className="storage-note">
            <Folder className="icon" />
            <span>
              {google
                ? `Saved to Google Drive › ${rootFolderName} › ${folderName}. Column K in the sheet links to this folder, so the sheet still shows that the row has media.`
                : 'Files are stored on the tracker server and shown only to signed-in users.'}
            </span>
          </div>

          {history && history.length > 0 && (
            <>
              <h3>History</h3>
              <div className="history">
                {history.slice(0, 30).map((h, i) => (
                  <div className="h" key={i}>
                    <span className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {h.timestamp}
                    </span>
                    <span>
                      <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{h.field}</strong>
                      {h.from || h.to ? `: ${h.from || '—'} → ${h.to || '—'}` : ''} · {h.by || '—'}
                      {h.source && h.source !== 'App' ? ` (${h.source})` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function EditDetailsDialog({ row, onClose, onSave }: { row: Row; onClose: () => void; onSave: (c: Record<string, string>) => void }) {
  const [v, setV] = useState({ title: row.title, reportedDate: row.reportedDate, endDate: row.endDate, milestone: row.milestone, deliverable: row.deliverable, notes: row.notes });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog title={`Edit row ${row.rowNumber}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const changes: Record<string, string> = {};
          (Object.keys(v) as (keyof typeof v)[]).forEach((k) => {
            if (v[k] !== row[k]) changes[k] = v[k];
          });
          if (Object.keys(changes).length) onSave(changes);
          else onClose();
        }}
      >
        <div className="field">
          <label htmlFor="ed-title">Change Request</label>
          <textarea id="ed-title" className="input" value={v.title} onChange={set('title')} required maxLength={5000} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="ed-rd">Reported Date</label>
            <input id="ed-rd" className="input" type="date" value={isoFromUk(v.reportedDate)} onChange={(e) => setV({ ...v, reportedDate: ukDate(e.target.value) })} required />
          </div>
          <div className="field">
            <label htmlFor="ed-ed">End date</label>
            <input id="ed-ed" className="input" type="date" value={isoFromUk(v.endDate)} onChange={(e) => setV({ ...v, endDate: ukDate(e.target.value) })} />
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="ed-ms">Milestone</label>
            <input id="ed-ms" className="input" value={v.milestone} onChange={set('milestone')} maxLength={500} />
          </div>
          <div className="field">
            <label htmlFor="ed-dl">Deliverable</label>
            <input id="ed-dl" className="input" value={v.deliverable} onChange={set('deliverable')} maxLength={500} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ed-notes">Notes</label>
          <textarea id="ed-notes" className="input" value={v.notes} onChange={set('notes')} maxLength={5000} />
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
