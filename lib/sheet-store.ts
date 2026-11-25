import crypto from 'node:crypto';
import { config } from './config';
import { db, getSetting, setSetting } from './db';
import { isoToUk, parseUkDate, todayIso, ukTimestamp } from './dates';
import { drive, folderIdFromUrl, folderUrl } from './google/drive';
import { GoogleError, googleConnected } from './google/oauth';
import { rng, sheets } from './google/sheets';
import { PEOPLE_HEADER, parsePeopleGrid, sortPeople, suggestPeople } from './people';
import {
  buildRows,
  computeStats,
  findPersonClash,
  gridToRawRows,
  normalizeText,
  resolveName,
  buildPeopleIndex,
  rowKeyFromValues,
  validatePersonName,
  type RawRow,
} from './rows';
import { HEADERS, PRIORITIES, STATUSES, type ChangeLogEntry, type MediaSummary, type Person, type Row, type Stats } from './types';

export const CHANGELOG_HEADER = ['Timestamp', 'Sheet row', 'Row key', 'Bug', 'Field', 'From', 'To', 'By', 'Source', 'Note'];

export interface Actor {
  username: string;
  displayName: string;
  personName: string;
  role: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export const CONFLICT_MSG = 'This row changed in Google Sheets. Refresh and try again.';

interface StoreState {
  raw: RawRow[] | null;
  header: string[];
  people: Person[];
  peopleTabExists: boolean;
  changeLogTabExists: boolean;
  changeLog: ChangeLogEntry[];
  changeLogReadAt: number;
  tabsReadAt: number;
  gids: { sheet: number | null; changeLog: number | null; people: number | null };
  syncedAt: string | null;
  error: string | null;
  version: string;
  mediaVersion: number;
  lock: Promise<unknown>;
  timer?: NodeJS.Timeout;
}

const g = globalThis as unknown as { __smprdStore?: StoreState };
function S(): StoreState {
  if (!g.__smprdStore) {
    g.__smprdStore = {
      raw: null,
      header: [],
      people: [],
      peopleTabExists: false,
      changeLogTabExists: false,
      changeLog: [],
      changeLogReadAt: 0,
      tabsReadAt: 0,
      gids: { sheet: null, changeLog: null, people: null },
      syncedAt: null,
      error: null,
      version: '0',
      mediaVersion: 0,
      lock: Promise.resolve(),
    };
  }
  return g.__smprdStore;
}

/** Serialize all sheet reads/writes so the outside-edit diff never sees our own writes as foreign. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const s = S();
  const run = s.lock.then(fn, fn);
  s.lock = run.catch(() => undefined);
  return run;
}

const pad = (v: string[]) => {
  const r = v.map((x) => (x == null ? '' : String(x)));
  while (r.length < HEADERS.length) r.push('');
  return r.slice(0, HEADERS.length);
};

function canUseGoogle() {
  return config().standalone || googleConnected();
}

function bumpVersion() {
  const s = S();
  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(s.raw));
  h.update(JSON.stringify(s.people));
  h.update(String(s.mediaVersion));
  h.update(String(s.changeLog.length));
  s.version = h.digest('hex').slice(0, 16);
}

export function touchMedia() {
  S().mediaVersion++;
  bumpVersion();
}

async function readTabs(force = false) {
  const s = S();
  const c = config();
  if (!force && Date.now() - s.tabsReadAt < 10 * 60_000) return;
  const tabs = await sheets().listTabs();
  const find = (t: string) => tabs.find((x) => x.title === t);
  s.gids.sheet = find(c.SHEET_TAB)?.sheetId ?? null;
  s.gids.changeLog = find(c.CHANGELOG_TAB)?.sheetId ?? null;
  s.gids.people = find(c.PEOPLE_TAB)?.sheetId ?? null;
  s.changeLogTabExists = s.gids.changeLog !== null;
  s.peopleTabExists = s.gids.people !== null;
  s.tabsReadAt = Date.now();
  if (s.gids.sheet !== null) setSetting('sheetGid', String(s.gids.sheet));
  if (s.gids.changeLog !== null) setSetting('changeLogGid', String(s.gids.changeLog));
  if (s.gids.people !== null) setSetting('peopleGid', String(s.gids.people));
}

function parseChangeLog(grid: string[][]): ChangeLogEntry[] {
  return grid
    .filter((r) => r && r.length && r[0])
    .map((r) => ({
      timestamp: r[0] ?? '',
      sheetRow: r[1] ?? '',
      rowKey: r[2] ?? '',
      bug: r[3] ?? '',
      field: r[4] ?? '',
      from: r[5] ?? '',
      to: r[6] ?? '',
      by: r[7] ?? '',
      source: r[8] ?? '',
      note: r[9] ?? '',
    }));
}

function lastChangeByKey(): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of S().changeLog) {
    const iso = parseUkDate(e.timestamp);
    if (!iso || !e.rowKey) continue;
    const prev = m.get(e.rowKey);
    if (!prev || iso > prev) m.set(e.rowKey, iso);
  }
  return m;
}

/** Diff two snapshots and produce "Sheet (outside app)" change-log lines. */
export function diffSnapshots(prev: RawRow[], next: RawRow[], tz: string): string[][] {
  const pm = new Map<string, RawRow[]>();
  for (const r of prev) {
    const k = rowKeyFromValues(r.values);
    pm.set(k, [...(pm.get(k) ?? []), r]);
  }
  const lines: string[][] = [];
  const ts = ukTimestamp(tz);
  const seen = new Set<string>();
  for (const r of next) {
    const k = rowKeyFromValues(r.values);
    if (seen.has(k)) continue;
    seen.add(k);
    const before = pm.get(k);
    if (!before) {
      lines.push([ts, String(r.rowNumber), k, r.values[0].slice(0, 80), 'Row added', '', '', '—', 'Sheet (outside app)', '']);
      continue;
    }
    if (before.length !== 1) continue;
    const b = before[0].values;
    for (let i = 1; i < HEADERS.length; i++) {
      if ((b[i] ?? '').trim() !== (r.values[i] ?? '').trim()) {
        lines.push([ts, String(r.rowNumber), k, r.values[0].slice(0, 80), HEADERS[i], b[i] ?? '', r.values[i] ?? '', '—', 'Sheet (outside app)', '']);
      }
    }
  }
  return lines.slice(0, 200);
}

async function appendChangeLog(lines: string[][]) {
  if (!lines.length) return;
  const s = S();
  const c = config();
  s.changeLog.push(...parseChangeLog(lines));
  if (!s.changeLogTabExists) return; // kept in memory until the tab is created
  try {
    await sheets().append(rng(c.CHANGELOG_TAB, 'A:J'), lines);
  } catch (e) {
    console.error('[change-log] append failed:', (e as Error).message);
  }
}

async function syncUnlocked(opts: { forceChangeLog?: boolean } = {}) {
  const s = S();
  const c = config();
  if (!canUseGoogle()) {
    s.error = 'Google not connected';
    return;
  }
  try {
    await readTabs();
    const ranges = [rng(c.SHEET_TAB, 'A1:K')];
    if (s.peopleTabExists) ranges.push(rng(c.PEOPLE_TAB, 'A1:E'));
    const readLog = s.changeLogTabExists && (opts.forceChangeLog || Date.now() - s.changeLogReadAt > 10 * 60_000);
    if (readLog) ranges.push(rng(c.CHANGELOG_TAB, 'A2:J'));
    const res = await sheets().batchGet(ranges);
    const grid = res[0];
    const raw = gridToRawRows(grid);
    let i = 1;
    if (s.peopleTabExists) s.people = parsePeopleGrid(res[i++]);
    if (readLog) {
      s.changeLog = parseChangeLog(res[i++]);
      s.changeLogReadAt = Date.now();
    }
    const prev = s.raw;
    s.header = grid[0] ?? [];
    s.raw = raw;
    if (prev) await appendChangeLog(diffSnapshots(prev, raw, c.TZ));
    s.syncedAt = new Date().toISOString();
    s.error = null;
    bumpVersion();
  } catch (e) {
    s.error = (e as Error).message;
    console.error('[sync] failed:', s.error);
    if (e instanceof GoogleError && e.reason === 'lost') return;
  }
}

export function sync(opts: { forceChangeLog?: boolean } = {}) {
  return withLock(() => syncUnlocked(opts));
}

export function startSyncLoop() {
  const s = S();
  if (s.timer) return;
  const c = config();
  void sync({ forceChangeLog: true });
  s.timer = setInterval(() => void sync(), Math.max(5, c.SYNC_SECONDS) * 1000);
  s.timer.unref?.();
}

async function ensureFresh() {
  if (!S().raw && canUseGoogle()) await sync({ forceChangeLog: true });
}

// ---------- media index from SQLite ----------
interface MediaRow {
  file_id: string;
  folder_id: string;
  row_key: string;
  name: string;
  mime_type: string;
  kind: 'photo' | 'video';
  size: number;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  caption: string | null;
  uploader_username: string | null;
  uploader_name: string | null;
  created_at: string;
  thumb_file_id: string | null;
  status: 'processing' | 'ready' | 'failed';
}
export function mediaSummary(m: MediaRow): MediaSummary {
  return {
    fileId: m.file_id,
    name: m.name,
    kind: m.kind,
    mimeType: m.mime_type,
    size: m.size,
    durationS: m.duration_s,
    width: m.width,
    height: m.height,
    caption: m.caption,
    uploaderUsername: m.uploader_username,
    uploaderName: m.uploader_name,
    createdAt: m.created_at,
    status: m.status,
    hasThumb: !!m.thumb_file_id,
  };
}
function mediaIndex() {
  const all = db().prepare('SELECT * FROM media ORDER BY created_at ASC').all() as MediaRow[];
  const byKey = new Map<string, MediaSummary[]>();
  const byFolder = new Map<string, MediaSummary[]>();
  for (const m of all) {
    const ms = mediaSummary(m);
    byKey.set(m.row_key, [...(byKey.get(m.row_key) ?? []), ms]);
    byFolder.set(m.folder_id, [...(byFolder.get(m.folder_id) ?? []), ms]);
  }
  return { byKey, byFolder };
}

// ---------- read API ----------
export interface Snapshot {
  version: string;
  syncedAt: string | null;
  error: string | null;
  rows: Row[];
  stats: Stats;
  people: Person[];
  lastActivity: string | null;
  gids: StoreState['gids'];
  header: string[];
  peopleTabExists: boolean;
  changeLogTabExists: boolean;
}

export async function snapshot(): Promise<Snapshot> {
  await ensureFresh();
  const s = S();
  const c = config();
  const { byKey, byFolder } = mediaIndex();
  const rows = buildRows(s.raw ?? [], {
    people: s.people,
    lastChangeByKey: lastChangeByKey(),
    mediaByKey: byKey,
    mediaByFolder: byFolder,
    stallDays: Number(getSetting('stallDays') ?? c.STALL_DAYS),
    today: todayIso(c.TZ),
  });
  const stats = computeStats(rows, c.openStatuses);
  const acts = [
    ...rows.map((r) => parseUkDate(r.reportedDate)),
    ...s.changeLog.map((e) => parseUkDate(e.timestamp)),
  ].filter((x): x is string => !!x);
  return {
    version: s.version,
    syncedAt: s.syncedAt,
    error: s.error,
    rows,
    stats,
    people: sortPeople(s.people),
    lastActivity: acts.sort().pop() ?? null,
    gids: s.gids,
    header: s.header,
    peopleTabExists: s.peopleTabExists,
    changeLogTabExists: s.changeLogTabExists,
  };
}

export function changesForKey(key: string): ChangeLogEntry[] {
  return S().changeLog.filter((e) => e.rowKey === key);
}

export function syncStatus() {
  const s = S();
  return { syncedAt: s.syncedAt, error: s.error, version: s.version };
}

export function peopleNow(): Person[] {
  return sortPeople(S().people);
}

// ---------- safe writes ----------
interface Resolved {
  n: number;
  values: string[];
  movedFrom?: number;
}

async function resolveRow(n: number, key: string): Promise<Resolved> {
  const c = config();
  const s = S();
  const dupes = (s.raw ?? []).filter((r) => rowKeyFromValues(r.values) === key).length;
  const [vals] = await sheets().batchGet([rng(c.SHEET_TAB, `A${n}:K${n}`)]);
  const cur = pad(vals[0] ?? []);
  if (cur[0].trim() && rowKeyFromValues(cur) === key) {
    if (dupes > 1) throw new HttpError(409, CONFLICT_MSG, { duplicate: true });
    return { n, values: cur };
  }
  await syncUnlocked();
  const matches = (s.raw ?? []).filter((r) => rowKeyFromValues(r.values) === key);
  if (matches.length === 1) return { n: matches[0].rowNumber, values: pad(matches[0].values), movedFrom: n };
  throw new HttpError(409, CONFLICT_MSG);
}

function applyLocal(n: number, values: string[]) {
  const s = S();
  if (!s.raw) return;
  const i = s.raw.findIndex((r) => r.rowNumber === n);
  if (i >= 0) s.raw[i] = { rowNumber: n, values: pad(values) };
  else {
    s.raw.push({ rowNumber: n, values: pad(values) });
    s.raw.sort((a, b) => a.rowNumber - b.rowNumber);
  }
  bumpVersion();
}

function logLine(n: number, key: string, title: string, field: string, from: string, to: string, by: string, note = ''): string[] {
  return [ukTimestamp(config().TZ), String(n), key, title.slice(0, 80), field, from, to, by, 'App', note];
}

function requireActivePerson(name: string, allowBlank: boolean): string {
  const t = name.trim();
  if (!t) {
    if (allowBlank) return '';
    throw new HttpError(422, 'Choose a name.');
  }
  const p = S().people.find((x) => normalizeText(x.name) === normalizeText(t));
  if (!p) {
    // Allow names that resolve through spellings (e.g. picking a raw value).
    const idx = buildPeopleIndex(S().people);
    const r = resolveName(t, idx);
    if (r.known) return r.name;
    if (!S().peopleTabExists) return t; // People tab not set up yet: accept as typed
    throw new HttpError(422, `"${t}" is not in People. Add it as a new name first.`);
  }
  return p.name;
}

export interface RowChanges {
  status?: string;
  priority?: string;
  reporter?: string;
  owner?: string;
  // Standalone mode only (in Google mode these are edited in Sheets):
  title?: string;
  reportedDate?: string;
  endDate?: string;
  milestone?: string;
  deliverable?: string;
  notes?: string;
}

function normDate(v: string, field: string): string {
  const t = v.trim();
  if (!t) return '';
  const iso = parseUkDate(t);
  if (!iso) throw new HttpError(422, `${field}: use dd/mm/yyyy.`);
  return isoToUk(iso);
}

export function updateRow(n: number, key: string, changes: RowChanges, actor: Actor) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    if (changes.status !== undefined && !(STATUSES as readonly string[]).includes(changes.status)) throw new HttpError(422, 'Unknown status.');
    if (changes.priority !== undefined && !(PRIORITIES as readonly string[]).includes(changes.priority)) throw new HttpError(422, 'Unknown priority.');
    const reporter = changes.reporter !== undefined ? requireActivePerson(changes.reporter, false) : undefined;
    const owner = changes.owner !== undefined ? requireActivePerson(changes.owner, true) : undefined;

    const r = await resolveRow(n, key);
    const v = [...r.values];
    const updates: { range: string; values: string[][] }[] = [];
    const lines: string[][] = [];
    const by = actor.personName || actor.displayName;
    const set = (col: number, letter: string, field: string, val: string) => {
      if ((v[col] ?? '').trim() === val.trim()) return;
      updates.push({ range: rng(c.SHEET_TAB, `${letter}${r.n}`), values: [[val]] });
      lines.push(logLine(r.n, key, v[0], field, v[col] ?? '', val, by));
      v[col] = val;
    };
    if (changes.priority !== undefined) set(1, 'B', 'Priority', changes.priority);
    if (reporter !== undefined) set(2, 'C', 'Reported By', reporter);
    if (changes.status !== undefined) {
      set(3, 'D', 'Status', changes.status);
      if (changes.status === 'Completed' && c.AUTO_END_DATE && !v[5].trim()) set(5, 'F', 'End date', isoToUk(todayIso(c.TZ)));
    }
    if (owner !== undefined) set(7, 'H', 'Bug Owner', owner);
    const textEdit = ['title', 'reportedDate', 'endDate', 'milestone', 'deliverable', 'notes'].some((k) => (changes as Record<string, unknown>)[k] !== undefined);
    if (textEdit && !c.standalone) throw new HttpError(422, 'Edit this field in Google Sheets.');
    if (changes.title !== undefined) {
      const t = changes.title.trim();
      if (!t) throw new HttpError(422, 'Describe the bug.');
      set(0, 'A', 'Bugs', t.slice(0, 5000));
    }
    if (changes.reportedDate !== undefined) {
      const d = normDate(changes.reportedDate, 'Reported Date');
      if (!d) throw new HttpError(422, 'Reported Date is required.');
      set(4, 'E', 'Reported Date', d);
    }
    if (changes.endDate !== undefined) set(5, 'F', 'End date', normDate(changes.endDate, 'End date'));
    if (changes.milestone !== undefined) set(6, 'G', 'Milestone', changes.milestone.trim().slice(0, 500));
    if (changes.deliverable !== undefined) set(8, 'I', 'Deliverable', changes.deliverable.trim().slice(0, 500));
    if (changes.notes !== undefined) set(9, 'J', 'Notes', changes.notes.trim().slice(0, 5000));
    const newKey = rowKeyFromValues(v);
    if (newKey !== key && (S().raw ?? []).some((x) => x.rowNumber !== r.n && rowKeyFromValues(x.values) === newKey))
      throw new HttpError(409, 'Another row already has the same date and text.');
    if (updates.length) {
      await sheets().batchUpdate(updates);
      applyLocal(r.n, v);
      if (newKey !== key) {
        // Keep photos/videos and history attached when the text or date changes.
        db().prepare('UPDATE media SET row_key = ? WHERE row_key = ?').run(newKey, key);
        db().prepare('UPDATE uploads SET row_key = ? WHERE row_key = ?').run(newKey, key);
        for (const e of S().changeLog) if (e.rowKey === key) e.rowKey = newKey;
        for (const l of lines) l[2] = newKey;
      }
      await appendChangeLog(lines);
      bumpVersion();
    }
    return { rowNumber: r.n, rowKey: newKey, movedFrom: r.movedFrom, changed: lines.map((l) => ({ field: l[4], from: l[5], to: l[6] })) };
  });
}

async function ensureFreshUnlocked() {
  if (!canUseGoogle()) throw new HttpError(503, 'Google is not connected. An admin needs to connect Google in Admin.');
  if (!S().raw) await syncUnlocked({ forceChangeLog: true });
}

export interface NewRow {
  title: string;
  priority: string;
  status: string;
  reporter: string;
  owner: string;
  notes: string;
}

export function addRow(input: NewRow, actor: Actor) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    if (!input.title.trim()) throw new HttpError(422, 'Describe the bug.');
    if (!(STATUSES as readonly string[]).includes(input.status)) throw new HttpError(422, 'Unknown status.');
    if (!(PRIORITIES as readonly string[]).includes(input.priority)) throw new HttpError(422, 'Unknown priority.');
    const selfName = actor.personName || actor.displayName;
    const reporterIn = input.reporter || selfName;
    if (c.standalone && normalizeText(reporterIn) === normalizeText(selfName)) await ensurePersonUnlocked(selfName, actor.displayName);
    const reporter = requireActivePerson(reporterIn, false);
    const owner = requireActivePerson(input.owner, true);
    const values = [input.title.trim(), input.priority, reporter, input.status, isoToUk(todayIso(c.TZ)), '', '', owner, '', input.notes.trim(), ''];
    const n = (await sheets().append(rng(c.SHEET_TAB, 'A:K'), [values])) ?? ((S().raw ?? []).reduce((m, r) => Math.max(m, r.rowNumber), 1) + 1);
    applyLocal(n, values);
    const key = rowKeyFromValues(values);
    await appendChangeLog([logLine(n, key, values[0], 'Row added', '', values[0].slice(0, 80), actor.personName || actor.displayName)]);
    bumpVersion();
    return { rowNumber: n, rowKey: key };
  });
}

/** Ensure the row has a Drive folder; writes its link to column K. Returns the folder id. */
export function ensureRowFolder(n: number, key: string) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    const r = await resolveRow(n, key);
    const existing = folderIdFromUrl(r.values[10]);
    if (existing && (await drive().isAlive(existing))) return { folderId: existing, rowNumber: r.n, title: r.values[0] };
    const root = await ensureDriveRootUnlocked();
    const iso = parseUkDate(r.values[4]) ?? todayIso(c.TZ);
    const name = `${iso} · ${r.values[0].replace(/[\r\n/\\]+/g, ' ').trim().slice(0, 50)}`;
    const id = await drive().createFolder(name, root.rootId, { rowKey: key });
    const url = folderUrl(id);
    await sheets().batchUpdate([{ range: rng(c.SHEET_TAB, `K${r.n}`), values: [[url]] }]);
    const v = [...r.values];
    v[10] = url;
    applyLocal(r.n, v);
    return { folderId: id, rowNumber: r.n, title: r.values[0] };
  });
}

export function logMediaChange(rowKeyStr: string, field: string, from: string, to: string, actor: { name: string }, note = '') {
  return withLock(async () => {
    const row = (S().raw ?? []).find((r) => rowKeyFromValues(r.values) === rowKeyStr);
    await appendChangeLog([logLine(row?.rowNumber ?? 0, rowKeyStr, row?.values[0] ?? '', field, from, to, actor.name, note)]);
    bumpVersion();
  });
}

export function findRowByKey(key: string): { rowNumber: number; title: string } | null {
  const r = (S().raw ?? []).find((x) => rowKeyFromValues(x.values) === key);
  return r ? { rowNumber: r.rowNumber, title: r.values[0] } : null;
}

// ---------- People ----------
export function addPerson(nameIn: string, spellingsIn: string[], actor: Actor) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    const s = S();
    if (!s.peopleTabExists) throw new HttpError(409, 'The People tab is not set up yet. Ask an admin to run the setup checks.');
    const name = nameIn.trim().replace(/\s+/g, ' ');
    const err = validatePersonName(name);
    if (err) throw new HttpError(422, err);
    const spellings = spellingsIn.map((x) => x.trim()).filter(Boolean);
    const [grid] = await sheets().batchGet([rng(c.PEOPLE_TAB, 'A1:E')]);
    s.people = parsePeopleGrid(grid);
    const clash = findPersonClash(name, spellings, s.people);
    if (clash) throw new HttpError(409, `"${clash.name}" already exists.`, { existing: clash });
    const today = isoToUk(todayIso(c.TZ));
    const by = actor.displayName;
    const row = await sheets().append(rng(c.PEOPLE_TAB, 'A:E'), [[name, spellings.join(', '), 'TRUE', by, today]]);
    const person: Person = { name, spellings, active: true, addedBy: by, addedOn: today, sheetRow: row ?? undefined };
    s.people.push(person);
    await appendChangeLog([[ukTimestamp(c.TZ), '', '', '', 'Name added', '', name, actor.personName || by, 'App', spellings.length ? `Spellings: ${spellings.join(', ')}` : '']]);
    bumpVersion();
    return person;
  });
}

export interface PersonPatch {
  newName?: string;
  spellings?: string[];
  active?: boolean;
  mergeInto?: string;
  updateRows?: boolean;
}

export function updatePerson(name: string, patch: PersonPatch, actor: Actor) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    const s = S();
    const [grid] = await sheets().batchGet([rng(c.PEOPLE_TAB, 'A1:E')]);
    s.people = parsePeopleGrid(grid);
    const p = s.people.find((x) => normalizeText(x.name) === normalizeText(name));
    if (!p || !p.sheetRow) throw new HttpError(404, 'Name not found.');
    const by = actor.personName || actor.displayName;
    const lines: string[][] = [];
    const ts = ukTimestamp(c.TZ);
    if (patch.mergeInto) {
      const target = s.people.find((x) => normalizeText(x.name) === normalizeText(patch.mergeInto!));
      if (!target || !target.sheetRow || target === p) throw new HttpError(422, 'Choose another existing name to merge into.');
      const sp = [...new Set([...target.spellings, p.name, ...p.spellings])].filter((x) => normalizeText(x) !== normalizeText(target.name));
      await sheets().batchUpdate([
        { range: rng(c.PEOPLE_TAB, `B${target.sheetRow}`), values: [[sp.join(', ')]] },
        { range: rng(c.PEOPLE_TAB, `A${p.sheetRow}:E${p.sheetRow}`), values: [['', '', '', '', '']] },
      ]);
      lines.push([ts, '', '', '', 'Name merged', p.name, target.name, by, 'App', '']);
      if (patch.updateRows) {
        const idx = new Set([p.name, ...p.spellings].map(normalizeText));
        const ups: { range: string; values: string[][] }[] = [];
        for (const r of s.raw ?? []) {
          const v = [...r.values];
          let changed = false;
          for (const [col, letter, field] of [[2, 'C', 'Reported By'], [7, 'H', 'Bug Owner']] as const) {
            if (idx.has(normalizeText(v[col]))) {
              ups.push({ range: rng(c.SHEET_TAB, `${letter}${r.rowNumber}`), values: [[target.name]] });
              lines.push(logLine(r.rowNumber, rowKeyFromValues(v), v[0], field, v[col], target.name, by, 'Merged names'));
              v[col] = target.name;
              changed = true;
            }
          }
          if (changed) applyLocal(r.rowNumber, v);
        }
        if (ups.length) await sheets().batchUpdate(ups);
      }
    } else {
      const newName = patch.newName?.trim().replace(/\s+/g, ' ') || p.name;
      if (newName !== p.name) {
        const err = validatePersonName(newName);
        if (err) throw new HttpError(422, err);
        const clash = findPersonClash(newName, [], s.people.filter((x) => x !== p));
        if (clash) throw new HttpError(409, `"${clash.name}" already exists.`, { existing: clash });
      }
      let spellings = patch.spellings ?? p.spellings;
      if (newName !== p.name) spellings = [...new Set([...spellings, p.name])];
      spellings = spellings.map((x) => x.trim()).filter((x) => x && normalizeText(x) !== normalizeText(newName));
      const active = patch.active ?? p.active;
      await sheets().batchUpdate([{ range: rng(c.PEOPLE_TAB, `A${p.sheetRow}:C${p.sheetRow}`), values: [[newName, spellings.join(', '), active ? 'TRUE' : 'FALSE']] }]);
      if (newName !== p.name) lines.push([ts, '', '', '', 'Name renamed', p.name, newName, by, 'App', '']);
      if (active !== p.active) lines.push([ts, '', '', '', 'Name active', String(p.active), String(active), by, 'App', newName]);
    }
    const [grid2] = await sheets().batchGet([rng(c.PEOPLE_TAB, 'A1:E')]);
    s.people = parsePeopleGrid(grid2);
    await appendChangeLog(lines);
    bumpVersion();
    return sortPeople(s.people);
  });
}

// ---------- Setup ----------
export async function ensureDriveRootUnlocked(): Promise<{ rootId: string; previewsId: string }> {
  const c = config();
  let rootId = getSetting('driveRootFolderId');
  if (!rootId || !(await drive().isAlive(rootId))) {
    rootId = (await drive().findFolder(c.DRIVE_ROOT_FOLDER_NAME, null)) ?? (await drive().createFolder(c.DRIVE_ROOT_FOLDER_NAME, null, { role: 'root' }));
    setSetting('driveRootFolderId', rootId);
  }
  let previewsId = getSetting('drivePreviewsFolderId');
  if (!previewsId || !(await drive().isAlive(previewsId))) {
    previewsId = (await drive().findFolder('_previews', rootId)) ?? (await drive().createFolder('_previews', rootId, { role: 'previews' }));
    setSetting('drivePreviewsFolderId', previewsId);
  }
  return { rootId, previewsId };
}
export function ensureDriveRoot() {
  return withLock(() => ensureDriveRootUnlocked());
}

export interface SetupCheck {
  step: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export async function setupChecks(): Promise<SetupCheck[]> {
  const c = config();
  const out: SetupCheck[] = [];
  if (!canUseGoogle()) {
    return [{ step: 'google', label: 'Google connected', ok: false, detail: 'Connect Google first.' }];
  }
  await withLock(async () => {
    try {
      await readTabs(true);
      await syncUnlocked({ forceChangeLog: true });
      const s = S();
      out.push({ step: 'sheet', label: `Sheet readable (${c.SHEET_TAB})`, ok: s.gids.sheet !== null && !s.error, detail: s.error ?? `${s.raw?.length ?? 0} rows` });
      out.push({ step: 'k1-header', label: 'K1 header is "Media"', ok: (s.header[10] ?? '').trim() === 'Media', detail: `K1 = "${s.header[10] ?? ''}"` });
      out.push({ step: 'change-log-tab', label: `"${c.CHANGELOG_TAB}" tab exists`, ok: s.changeLogTabExists });
      out.push({ step: 'people-tab', label: `"${c.PEOPLE_TAB}" tab exists`, ok: s.peopleTabExists });
    } catch (e) {
      out.push({ step: 'sheet', label: 'Sheet readable', ok: false, detail: (e as Error).message });
    }
  });
  try {
    const rootId = getSetting('driveRootFolderId');
    const rootOk = !!rootId && (await drive().isAlive(rootId));
    out.push({ step: 'drive-root', label: `Drive folder "${c.DRIVE_ROOT_FOLDER_NAME}" exists`, ok: rootOk });
    const pid = getSetting('drivePreviewsFolderId');
    out.push({ step: 'previews-folder', label: '"_previews" folder exists', ok: rootOk && !!pid && (await drive().isAlive(pid)) });
  } catch (e) {
    out.push({ step: 'drive-root', label: 'Drive reachable', ok: false, detail: (e as Error).message });
  }
  return out;
}

export function runSetupStep(step: string) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    const c = config();
    const s = S();
    switch (step) {
      case 'k1-header':
        await sheets().batchUpdate([{ range: rng(c.SHEET_TAB, 'K1'), values: [['Media']] }]);
        break;
      case 'change-log-tab': {
        await readTabs(true);
        if (!s.changeLogTabExists) {
          await sheets().addTab(c.CHANGELOG_TAB);
          await sheets().batchUpdate([{ range: rng(c.CHANGELOG_TAB, 'A1:J1'), values: [CHANGELOG_HEADER] }]);
          await readTabs(true);
          // Flush lines kept in memory before the tab existed.
          if (s.changeLog.length) {
            const lines = s.changeLog.map((e) => [e.timestamp, e.sheetRow, e.rowKey, e.bug, e.field, e.from, e.to, e.by, e.source, e.note]);
            await sheets().append(rng(c.CHANGELOG_TAB, 'A:J'), lines);
          }
        }
        break;
      }
      case 'people-tab': {
        await readTabs(true);
        if (!s.peopleTabExists) {
          await sheets().addTab(c.PEOPLE_TAB);
          const values = (s.raw ?? []).flatMap((r) => [r.values[2], r.values[7]]);
          const today = isoToUk(todayIso(c.TZ));
          const ppl = suggestPeople(values);
          await sheets().batchUpdate([
            {
              range: rng(c.PEOPLE_TAB, `A1:E${ppl.length + 1}`),
              values: [PEOPLE_HEADER, ...ppl.map((p) => [p.name, p.spellings.join(', '), 'TRUE', 'setup', today])],
            },
          ]);
          await readTabs(true);
        }
        break;
      }
      case 'drive-root':
      case 'previews-folder':
        await ensureDriveRootUnlocked();
        break;
      default:
        throw new HttpError(404, 'Unknown setup step');
    }
    s.tabsReadAt = 0;
    await syncUnlocked({ forceChangeLog: true });
  });
}

// ---------- Standalone (local database) ----------
export function standaloneSetup() {
  return withLock(async () => {
    const c = config();
    if (!c.standalone) return;
    const tabs = await sheets().listTabs();
    const has = (t: string) => tabs.some((x) => x.title === t);
    if (!has(c.SHEET_TAB)) {
      await sheets().addTab(c.SHEET_TAB);
      await sheets().batchUpdate([{ range: rng(c.SHEET_TAB, 'A1:K1'), values: [[...HEADERS]] }]);
    }
    if (!has(c.CHANGELOG_TAB)) {
      await sheets().addTab(c.CHANGELOG_TAB);
      await sheets().batchUpdate([{ range: rng(c.CHANGELOG_TAB, 'A1:J1'), values: [CHANGELOG_HEADER] }]);
    }
    if (!has(c.PEOPLE_TAB)) {
      await sheets().addTab(c.PEOPLE_TAB);
      await sheets().batchUpdate([{ range: rng(c.PEOPLE_TAB, 'A1:E1'), values: [PEOPLE_HEADER] }]);
    }
    await ensureDriveRootUnlocked();
    const s = S();
    s.tabsReadAt = 0;
    await syncUnlocked({ forceChangeLog: true });
    if (c.SEED_CSV && !(s.raw ?? []).length) {
      const fs = await import('node:fs');
      if (fs.existsSync(c.SEED_CSV)) {
        const { parseCsv } = await import('./csv');
        await importUnlocked(parseCsv(fs.readFileSync(c.SEED_CSV, 'utf8')), 'replace', 'setup');
        console.log(`[setup] Imported ${(s.raw ?? []).length} rows from ${c.SEED_CSV}`);
      }
    } else if (c.SAMPLE_DATA && !c.demo && !(s.raw ?? []).length && !getSetting('sampleLoaded')) {
      const { sampleGrid } = await import('./sample-data');
      await importUnlocked(sampleGrid(c.TZ), 'replace', 'Sample data');
      setSetting('sampleLoaded', new Date().toISOString());
      console.log(`[setup] Loaded ${(s.raw ?? []).length} sample rows (set SAMPLE_DATA=false to skip).`);
      sampleMediaPending = true;
    }
  });
}

let sampleMediaPending = false;
/** After the sample rows exist, attach a few generated photos and a video through the normal upload pipeline. */
export async function addSampleMediaIfPending() {
  if (!sampleMediaPending) return;
  sampleMediaPending = false;
  const { queueSampleMedia } = await import('./sample-data');
  await queueSampleMedia().catch((e) => console.warn('[setup] sample media skipped:', (e as Error).message));
}

const COL_ALIASES: Record<string, number> = {
  bugs: 0, bug: 0, title: 0, priority: 1, 'reported by': 2, reporter: 2, status: 3, 'reported date': 4, date: 4,
  'end date': 5, milestone: 6, 'bug owner': 7, owner: 7, deliverable: 8, notes: 9,
};

/** Map an uploaded CSV (header row + data) to A–J values. */
export function csvToRows(grid: string[][]): string[][] {
  const rows = grid.filter((r) => r.some((c) => (c ?? '').trim()));
  if (!rows.length) throw new HttpError(422, 'The file is empty.');
  const header = rows[0].map((h) => normalizeText(h));
  const map = header.map((h) => COL_ALIASES[h] ?? -1);
  if (!map.includes(0)) throw new HttpError(422, 'The first row must be the header and include a "Bugs" column.');
  const out: string[][] = [];
  for (const r of rows.slice(1)) {
    const v = Array(HEADERS.length).fill('') as string[];
    map.forEach((col, i) => {
      if (col >= 0) v[col] = (r[i] ?? '').trim();
    });
    if (!v[0]) continue;
    for (const d of [4, 5]) if (v[d]) v[d] = parseUkDate(v[d]) ? isoToUk(parseUkDate(v[d])!) : v[d];
    out.push(v);
  }
  return out;
}

async function importUnlocked(grid: string[][], mode: 'replace' | 'append', by: string) {
  const c = config();
  const s = S();
  const rows = csvToRows(grid);
  const be = sheets();
  if (!be.replaceGrid) throw new HttpError(422, 'Import is only available in standalone mode.');
  const existing = mode === 'append' ? (s.raw ?? []).map((r) => pad(r.values)) : [];
  // keep media links (column K) for rows that already existed with the same key
  const kByKey = new Map((s.raw ?? []).map((r) => [rowKeyFromValues(r.values), r.values[10]]));
  const incoming = rows.map((v) => {
    const k = kByKey.get(rowKeyFromValues(v));
    if (k) v[10] = k;
    return v;
  });
  await be.replaceGrid(c.SHEET_TAB, [[...HEADERS], ...existing, ...incoming]);
  // Names: add any Reported By / Bug Owner values People doesn't know yet.
  const known = buildPeopleIndex(s.people);
  const unknown = incoming.flatMap((v) => [v[2], v[7]]).filter((x) => x && !resolveName(x, known).known);
  const add = suggestPeople(unknown).filter((p) => !findPersonClash(p.name, p.spellings, s.people));
  if (add.length) {
    const today = isoToUk(todayIso(c.TZ));
    await be.append(rng(c.PEOPLE_TAB, 'A:E'), add.map((p) => [p.name, p.spellings.join(', '), 'TRUE', by, today]));
  }
  await appendChangeLog([[ukTimestamp(c.TZ), '', '', '', 'Rows imported', '', `${incoming.length} rows (${mode})`, by, 'App', '']]);
  s.raw = null;
  s.tabsReadAt = 0;
  await syncUnlocked({ forceChangeLog: true });
  return { imported: incoming.length, total: (s.raw ?? []).length, namesAdded: add.length };
}

export function importRows(grid: string[][], mode: 'replace' | 'append', actor: Actor) {
  return withLock(() => importUnlocked(grid, mode, actor.personName || actor.displayName));
}

export async function exportGrid(): Promise<string[][]> {
  const snap = await snapshot();
  return [
    ['Bugs', 'Priority', 'Reported By', 'Status', 'Reported Date', 'End date', 'Milestone', 'Bug Owner', 'Deliverable', 'Notes', 'Photos & videos'],
    ...snap.rows.map((r) => [r.title, r.priority, r.reporter, r.status, r.reportedDate, r.endDate, r.milestone, r.owner, r.deliverable, r.notes, String(r.media.length)]),
  ];
}

/** Add a name to People if it is not there yet (no error when it exists). */
async function ensurePersonUnlocked(name: string, by: string) {
  const c = config();
  const s = S();
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n || !s.peopleTabExists || validatePersonName(n)) return;
  if (findPersonClash(n, [], s.people)) return;
  const today = isoToUk(todayIso(c.TZ));
  const row = await sheets().append(rng(c.PEOPLE_TAB, 'A:E'), [[n, '', 'TRUE', by, today]]);
  s.people.push({ name: n, spellings: [], active: true, addedBy: by, addedOn: today, sheetRow: row ?? undefined });
  bumpVersion();
}
export function ensurePerson(name: string, by: string) {
  return withLock(async () => {
    await ensureFreshUnlocked();
    await ensurePersonUnlocked(name, by);
  });
}
