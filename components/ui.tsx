'use client';
import { ChevronDown, Eye, EyeOff, Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

export const STATUS_STYLE: Record<string, { text: string; bg: string; bar: string }> = {
  Completed: { text: '#166B43', bg: '#DDF3E6', bar: '#2E9E63' },
  'Feature existing': { text: '#0B6267', bg: '#DDF1F1', bar: '#3BA3A8' },
  'Feature not needed': { text: '#56606E', bg: '#EBEDF0', bar: '#A3ABB7' },
  'Feature is Coming soon': { text: '#5B3FC4', bg: '#ECE7FD', bar: '#8D74E6' },
  'In progress': { text: '#1F4FD8', bg: '#E6ECFD', bar: '#1F4FD8' },
  TBD: { text: '#8A5500', bg: '#FCEFD2', bar: '#D9961E' },
  Other: { text: '#56606E', bg: '#EBEDF0', bar: '#A3ABB7' },
};
export const PRIORITY_STYLE: Record<string, { text: string; bg: string }> = {
  High: { text: '#B42318', bg: '#FDE3E1' },
  Medium: { text: '#8A5500', bg: '#FCEFD2' },
  Low: { text: '#56606E', bg: '#EBEDF0' },
};
export const STATUS_ORDER = ['Completed', 'Feature existing', 'Feature not needed', 'Feature is Coming soon', 'In progress', 'TBD'];
export const STATUS_EDIT_ORDER = ['TBD', 'In progress', 'Feature is Coming soon', 'Completed', 'Feature existing', 'Feature not needed'];
export const PRIORITIES = ['High', 'Medium', 'Low'];

export function statusLabel(s: string) {
  if (s === 'Feature is Coming soon') return 'Coming soon';
  if (s === 'Feature not needed') return 'Not needed';
  return s;
}

export function StatusChip({ status, caret, busy }: { status: string; caret?: boolean; busy?: boolean }) {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.Other;
  return (
    <span className="chip" style={{ color: st.text, background: st.bg }}>
      {status || '—'}
      {busy ? <Loader2 className="spin" aria-hidden /> : caret ? <ChevronDown aria-hidden /> : null}
    </span>
  );
}
export function PriorityChip({ priority, caret, busy }: { priority: string; caret?: boolean; busy?: boolean }) {
  const st = PRIORITY_STYLE[priority] ?? { text: '#56606E', bg: '#EBEDF0' };
  return (
    <span className="chip" style={{ color: st.text, background: st.bg }}>
      {priority || '—'}
      {busy ? <Loader2 className="spin" aria-hidden /> : caret ? <ChevronDown aria-hidden /> : null}
    </span>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('touchstart', h);
    };
  }, [ref, onOut, active]);
}

/**
 * Places a dropdown with position: fixed next to its button, so the table's scroll box cannot clip it
 * (e.g. when only one or two rows are shown). Opens upwards when there is more room above.
 */
export function useFloating(open: boolean, anchor: RefObject<HTMLElement | null>, opts: { align?: 'left' | 'right'; width?: number } = {}): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  const { align = 'left', width = 220 } = opts;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const s: CSSProperties = { position: 'fixed', zIndex: 60, maxHeight: Math.max(120, Math.min(320, up ? above : below)) };
      // Set every side: the stylesheet's own top/left/right would otherwise still apply.
      s.top = up ? 'auto' : r.bottom + 4;
      s.bottom = up ? vh - r.top + 4 : 'auto';
      s.left = align === 'right' ? 'auto' : Math.max(8, Math.min(r.left, vw - width - 8));
      s.right = align === 'right' ? Math.max(8, vw - r.right) : 'auto';
      setStyle(s);
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, align, width]);
  return open ? style : undefined;
}

/** Small listbox dropdown used for Status and Priority. */
export function ChipSelect({
  value,
  options,
  render,
  onChange,
  disabled,
  label,
  busy,
}: {
  value: string;
  options: string[];
  render: (v: string, opts: { caret: boolean; busy: boolean }) => ReactNode;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useClickOutside(ref, () => setOpen(false), open);
  const pos = useFloating(open, btn, { width: 180 });
  if (disabled) return <>{render(value, { caret: false, busy: !!busy })}</>;
  const choose = (v: string) => {
    setOpen(false);
    btn.current?.focus();
    if (v !== value) onChange(v);
  };
  return (
    <div className="dd" ref={ref}>
      <button
        ref={btn}
        type="button"
        className="chip"
        style={{ padding: 0, background: 'none' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value || 'empty'}. Change`}
        onClick={() => {
          setHi(Math.max(0, options.indexOf(value)));
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setHi(Math.max(0, options.indexOf(value)));
            setOpen(true);
          } else if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[hi]); }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          }
        }}
        disabled={busy}
      >
        {render(value, { caret: true, busy: !!busy })}
      </button>
      {open && (
        <div className="dd-pop" style={pos} role="listbox" id={id} aria-label={label}>
          {options.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === hi}
              className={o === value ? 'current' : ''}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {render(o, { caret: false, busy: false })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, err }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), err ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- dialog ----------
export function Dialog({ title, onClose, children, labelledBy, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary, button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      className="dialog-wrap"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (dismissible) onClose();
        }
        if (e.key === 'Tab') trapTab(e, ref.current);
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? tid} ref={ref}>
        <h2 id={labelledBy ?? tid}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function trapTab(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const f = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, video[controls], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="row-btns">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'danger solid' : 'primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, required }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} spellCheck={false} autoCapitalize="off" />
      <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        {show ? <EyeOff className="icon" /> : <Eye className="icon" />}
      </button>
    </div>
  );
}

// ---------- helpers ----------
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
export function fmtDuration(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** "03/12/2026" → "2026-12-03" (for <input type="date">); "" when not a full date. */
export function isoFromUk(uk: string | null | undefined) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((uk ?? '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
export function ukDate(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let j: Record<string, unknown> = {};
  try {
    j = await r.json();
  } catch {}
  if (!r.ok) {
    if (r.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
    if (r.status === 403 && j.mustChangePassword && typeof window !== 'undefined') window.location.href = '/account/password';
    throw Object.assign(new Error((j.message as string) || `Request failed (${r.status})`), { status: r.status, data: j });
  }
  return j as T;
}

export function AppIcon() {
  return (
    <span className="app-icon" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    </span>
  );
}
