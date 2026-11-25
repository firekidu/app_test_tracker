'use client';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Person } from '@/lib/types';
import { Dialog, api, useClickOutside } from './ui';

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function guessName(raw: string) {
  const t = raw.trim();
  if (!t.includes('@')) return t;
  return t
    .split('@')[0]
    .replace(/[0-9]+$/, '')
    .replace(/[._+-]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function AddNameDialog({ initial, initialSpellings, onDone, onCancel }: { initial: string; initialSpellings?: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.includes('@') ? guessName(initial) : initial);
  const [spellings, setSpellings] = useState(initialSpellings ?? (initial.includes('@') ? initial : ''));
  const [error, setError] = useState('');
  const [existing, setExisting] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setExisting(null);
    try {
      const sp = spellings.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await api<{ person: Person }>('POST', '/api/people', { name, spellings: sp });
      onDone(r.person.name);
    } catch (err) {
      const e2 = err as Error & { status?: number; data?: { existing?: Person } };
      setError(e2.message);
      if (e2.status === 409 && e2.data?.existing) setExisting(e2.data.existing);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add a new name" onClose={onCancel}>
      <form onSubmit={submit}>
        {error && (
          <div className="form-error" role="alert">
            {error}{' '}
            {existing && (
              <button type="button" className="btn small" onClick={() => onDone(existing.name)}>
                Use {existing.name}
              </button>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="nn-name">Name</label>
          <input id="nn-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          <span className="hint">Letters, spaces, full stops, apostrophes and hyphens. No email addresses here.</span>
        </div>
        <div className="field">
          <label htmlFor="nn-sp">Other spellings (optional)</label>
          <input id="nn-sp" className="input" value={spellings} onChange={(e) => setSpellings(e.target.value)} placeholder="e.g. an email address used in old rows" />
          <span className="hint">Comma-separated. Old rows with these spellings will show this name.</span>
        </div>
        <div className="row-btns">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || name.trim().length < 2}>
            {busy ? 'Adding…' : 'Add name'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Searchable combobox for Reported By / Change owner with "+ Add name". */
export function NamePicker({
  value,
  raw,
  known,
  people,
  meName,
  allowNone,
  noneLabel = 'No owner',
  onChoose,
  disabled,
  label,
  busy,
  emptyText = '',
  inline = true,
}: {
  value: string;
  raw: string;
  known: boolean;
  people: Person[];
  meName: string;
  allowNone?: boolean;
  noneLabel?: string;
  onChoose: (name: string) => void;
  disabled?: boolean;
  label: string;
  busy?: boolean;
  emptyText?: string;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState<{ name: string; spellings?: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lbId = useId();
  useClickOutside(ref, () => setOpen(false), open && !adding);
  const isPhone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches;

  const options = useMemo(() => {
    const active = people.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
    const nq = norm(q);
    const list: { kind: 'none' | 'name' | 'add' | 'add-raw'; name: string; label: string }[] = [];
    if (allowNone && (!nq || norm(noneLabel).includes(nq))) list.push({ kind: 'none', name: '', label: noneLabel });
    for (const p of active) {
      if (nq && !norm(p.name).includes(nq) && !p.spellings.some((s) => norm(s).includes(nq))) continue;
      list.push({ kind: 'name', name: p.name, label: p.name + (norm(p.name) === norm(meName) ? ' (you)' : '') });
    }
    const exact = people.some((p) => norm(p.name) === nq || p.spellings.some((s) => norm(s) === nq));
    if (nq && !exact) list.push({ kind: 'add', name: q.trim(), label: `+ Add "${q.trim()}" as a new name` });
    if (!nq && !known && raw.trim()) list.push({ kind: 'add-raw', name: raw.trim(), label: `+ Add "${raw.trim()}" as a name` });
    return list;
  }, [people, q, allowNone, noneLabel, meName, known, raw]);

  useEffect(() => {
    if (open) {
      setHi(0);
      setTimeout(() => input.current?.focus(), 0);
    } else setQ('');
  }, [open]);

  const display = value ? value : emptyText;
  if (disabled)
    return (
      <span>
        {display}
        {!known && raw && <span className="not-in-people">not in People</span>}
      </span>
    );

  function choose(i: number) {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'add') {
      setAdding({ name: o.name });
      return;
    }
    if (o.kind === 'add-raw') {
      setAdding({ name: o.name, spellings: o.name.includes('@') ? o.name : undefined });
      return;
    }
    setOpen(false);
    btn.current?.focus();
    if (o.name !== value || !known) onChoose(o.name);
  }

  return (
    <div className="dd" ref={ref} style={inline ? undefined : { width: '100%' }}>
      <button
        type="button"
        ref={btn}
        className={inline ? 'name-btn' : 'input'}
        style={inline ? undefined : { textAlign: 'left', cursor: 'pointer' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value || 'none'}. Change`}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        {busy ? <Loader2 className="icon spin" /> : null}
        <span className={value ? '' : 'muted'}>{display || ' '}</span>
        {!known && raw && <span className="not-in-people">not in People</span>}
      </button>
      {open && (
        <div className={`dd-pop${isPhone ? ' sheet-mobile' : ''}`} style={{ minWidth: 220 }}>
          <input
            ref={input}
            className="input search-in"
            role="combobox"
            aria-expanded="true"
            aria-controls={lbId}
            aria-activedescendant={`${lbId}-${hi}`}
            aria-label={`Search ${label}`}
            placeholder="Type a name…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((h) => Math.min(options.length - 1, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(hi);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                btn.current?.focus();
              }
            }}
          />
          <div role="listbox" id={lbId} aria-label={label}>
            {options.map((o, i) => (
              <div
                key={`${o.kind}-${o.name}`}
                id={`${lbId}-${i}`}
                role="option"
                aria-selected={i === hi}
                className={`${o.kind.startsWith('add') ? 'add-opt' : ''} ${o.name === value && o.kind === 'name' ? 'current' : ''}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {o.kind.startsWith('add') && <Plus className="icon" />}
                {o.kind.startsWith('add') ? o.label.replace(/^\+ /, '') : o.label}
              </div>
            ))}
            {!options.length && <div className="muted" style={{ padding: 8, fontSize: 12.5 }}>No names yet.</div>}
          </div>
        </div>
      )}
      {adding && (
        <AddNameDialog
          initial={adding.name}
          initialSpellings={adding.spellings}
          onCancel={() => setAdding(null)}
          onDone={(name) => {
            setAdding(null);
            setOpen(false);
            onChoose(name);
          }}
        />
      )}
    </div>
  );
}
