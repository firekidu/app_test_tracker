import { daysBetween, parseUkDate } from './dates';
import { HEADERS, PRIORITIES, STATUSES, type MediaSummary, type Person, type Row, type Stats } from './types';

export function normalizeText(s: string | undefined | null): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Row key = <Reported Date yyyy-mm-dd>|<Bugs lower-case, spaces collapsed, first 60 chars>. */
export function rowKey(reportedDate: string | undefined | null, title: string | undefined | null): string {
  const iso = parseUkDate(reportedDate ?? '') ?? '';
  return `${iso}|${normalizeText(title).slice(0, 60)}`;
}

export function rowKeyFromValues(values: string[]): string {
  return rowKey(values[4], values[0]);
}

function folderIdOf(url: string): string | null {
  const m = /folders\/([A-Za-z0-9_-]+)/.exec(url ?? '');
  return m ? m[1] : null;
}

export interface RawRow {
  rowNumber: number;
  values: string[]; // A..K
}

/** Convert a values grid (row 1 = header) into raw rows. Ignores rows where A is empty. */
export function gridToRawRows(grid: string[][]): RawRow[] {
  const out: RawRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const v = (grid[i] ?? []).map((c) => (c == null ? '' : String(c)));
    while (v.length < HEADERS.length) v.push('');
    if (!v[0].trim()) continue;
    out.push({ rowNumber: i + 1, values: v.slice(0, HEADERS.length) });
  }
  return out;
}

/** Map of normalized spelling → canonical person name. */
export function buildPeopleIndex(people: Person[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of people) {
    idx.set(normalizeText(p.name), p.name);
    for (const s of p.spellings) if (normalizeText(s)) idx.set(normalizeText(s), p.name);
  }
  return idx;
}

export function resolveName(raw: string, idx: Map<string, string>): { name: string; known: boolean } {
  const n = normalizeText(raw);
  if (!n) return { name: '', known: true };
  const hit = idx.get(n);
  return hit ? { name: hit, known: true } : { name: raw.trim(), known: false };
}

export interface BuildOptions {
  people: Person[];
  lastChangeByKey: Map<string, string>; // rowKey → ISO date of latest change
  mediaByKey: Map<string, MediaSummary[]>;
  mediaByFolder?: Map<string, MediaSummary[]>;
  editsByKey?: Map<string, Record<string, { by: string; at: string }>>;
  stallDays: number;
  today: string; // ISO
}

export function buildRows(raw: RawRow[], o: BuildOptions): Row[] {
  const idx = buildPeopleIndex(o.people);
  const keyCount = new Map<string, number>();
  for (const r of raw) {
    const k = rowKeyFromValues(r.values);
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  return raw.map((r) => {
    const v = r.values;
    const key = rowKeyFromValues(v);
    const rep = resolveName(v[2], idx);
    const own = resolveName(v[7], idx);
    const reportedIso = parseUkDate(v[4]);
    const changeIso = o.lastChangeByKey.get(key) ?? null;
    const lastActivity = [reportedIso, changeIso].filter(Boolean).sort().pop() ?? null;
    const status = v[3].trim();
    const stalledDays = lastActivity ? daysBetween(lastActivity, o.today) : 0;
    const stalled = status === 'In progress' && lastActivity !== null && stalledDays > o.stallDays;
    return {
      rowNumber: r.rowNumber,
      rowKey: key,
      title: v[0],
      priority: v[1].trim(),
      reporter: rep.name,
      reporterRaw: v[2],
      reporterKnown: rep.known,
      status,
      reportedDate: v[4],
      endDate: v[5],
      milestone: v[6],
      owner: own.name,
      ownerRaw: v[7],
      ownerKnown: own.known,
      deliverable: v[8],
      notes: v[9],
      mediaFolderUrl: v[10],
      media: o.mediaByKey.get(key) ?? (o.mediaByFolder && folderIdOf(v[10]) ? o.mediaByFolder.get(folderIdOf(v[10])!) : undefined) ?? [],
      lastActivity,
      stalled,
      stalledDays: stalled ? stalledDays : 0,
      duplicate: (keyCount.get(key) ?? 0) > 1,
      edits: o.editsByKey?.get(key) ?? {},
    };
  });
}

export function computeStats(rows: Row[], openStatuses: string[]): Stats {
  const byStatus: Record<string, number> = {};
  for (const s of STATUSES) byStatus[s] = 0;
  let other = 0;
  for (const r of rows) {
    if ((STATUSES as readonly string[]).includes(r.status)) byStatus[r.status]++;
    else other++;
  }
  const total = rows.length;
  const completed = byStatus['Completed'];
  const openBreakdown: Record<string, number> = {};
  let open = 0;
  for (const s of openStatuses) {
    const c = rows.filter((r) => r.status === s).length;
    openBreakdown[s] = c;
    open += c;
  }
  const ip = rows.filter((r) => r.status === 'In progress');
  const stalled = ip.filter((r) => r.stalled);
  const oldest = ip.map((r) => r.lastActivity).filter((x): x is string => !!x).sort()[0] ?? null;
  const byPriority: Record<string, { done: number; total: number }> = {};
  for (const p of PRIORITIES) {
    const pr = rows.filter((r) => r.priority === p);
    byPriority[p] = { total: pr.length, done: pr.filter((r) => r.status === 'Completed').length };
  }
  const withMedia = rows.filter((r) => r.mediaFolderUrl && r.media.length > 0);
  const allMedia = rows.flatMap((r) => r.media);
  const latestThumbs = allMedia
    .filter((m) => m.hasThumb)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 3)
    .map((m) => m.fileId);
  return {
    total,
    byStatus,
    other,
    open,
    openBreakdown,
    completed,
    completedPct: total ? Math.round((completed / total) * 100) : 0,
    inProgress: {
      count: ip.length,
      rows: ip.map((r) => r.rowNumber),
      stalledRows: stalled.map((r) => r.rowNumber),
      oldestActivity: stalled.length ? (stalled.map((r) => r.lastActivity!).sort()[0] ?? null) : oldest,
      oldestDays: stalled.length ? Math.max(...stalled.map((r) => r.stalledDays)) : 0,
      blankOwnerRows: ip.filter((r) => !r.ownerRaw.trim()).map((r) => r.rowNumber),
    },
    byPriority,
    media: {
      rows: withMedia.length,
      photos: allMedia.filter((m) => m.kind === 'photo').length,
      videos: allMedia.filter((m) => m.kind === 'video').length,
      latestThumbs,
    },
  };
}

/** Validate a new People name (5.13). */
export function validatePersonName(name: string): string | null {
  const t = name.trim().replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 60) return 'Use 2–60 characters.';
  if (t.includes('@')) return 'Put email addresses in Other spellings, not in the name.';
  if (!/^[\p{L}\p{M} .'-]+$/u.test(t)) return "Use letters, spaces, full stops, apostrophes and hyphens only.";
  return null;
}

export function findPersonClash(name: string, spellings: string[], people: Person[]): Person | null {
  const idx = new Map<string, Person>();
  for (const p of people) {
    idx.set(normalizeText(p.name), p);
    for (const s of p.spellings) idx.set(normalizeText(s), p);
  }
  for (const c of [name, ...spellings]) {
    const hit = idx.get(normalizeText(c));
    if (hit) return hit;
  }
  return null;
}

/** Display label for status chips / filters. */
export function statusLabel(s: string): string {
  if (s === 'Feature is Coming soon') return 'Coming soon';
  if (s === 'Feature not needed') return 'Not needed';
  return s;
}
