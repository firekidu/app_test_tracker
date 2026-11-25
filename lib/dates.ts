/** Date helpers. The sheet uses UK dd/mm/yyyy; internally we use ISO yyyy-mm-dd. */

export function parseUkDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) {
    const [, d, mo, y] = m;
    const dd = Number(d), mm = Number(mo);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function isoToUk(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Today's date in the given zone as ISO yyyy-mm-dd. */
export function todayIso(tz = 'Europe/London', now = new Date()): string {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "24/11/2026 10:42" in the given zone. */
export function ukTimestamp(tz = 'Europe/London', now = new Date()): string {
  const p = parts(now, tz);
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.day}/${p.month}/${p.year} ${hh}:${p.minute}`;
}

/** Parse "24/11/2026 10:42" → ISO date part. */
export function ukTimestampToIso(s: string): string | null {
  return parseUkDate(s);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "4 Apr 2026" */
export function prettyDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
