import fs from 'node:fs';
import { config } from '../config';
import { parseCsv } from '../csv';
import { googleFetch } from './oauth';

export interface TabInfo {
  title: string;
  sheetId: number;
}

export interface SheetBackend {
  batchGet(ranges: string[]): Promise<string[][][]>;
  batchUpdate(data: { range: string; values: string[][] }[]): Promise<void>;
  /** Appends rows; returns the 1-based row number of the first appended row when known. */
  append(range: string, values: string[][]): Promise<number | null>;
  listTabs(): Promise<TabInfo[]>;
  addTab(title: string): Promise<number>;
}

/** 'Tab name'!A1:K */
export function rng(tab: string, a1: string) {
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export interface ParsedRange {
  tab: string;
  c1: number;
  r1: number | null; // 1-based
  c2: number;
  r2: number | null;
}

export function parseRange(range: string): ParsedRange {
  const bang = range.lastIndexOf('!');
  let tab = range.slice(0, bang);
  if (tab.startsWith("'")) tab = tab.slice(1, -1).replace(/''/g, "'");
  const a1 = range.slice(bang + 1);
  const [a, b] = a1.split(':');
  const pa = /^([A-Z]+)(\d+)?$/i.exec(a)!;
  const pb = b ? /^([A-Z]+)(\d+)?$/i.exec(b)! : pa;
  return {
    tab,
    c1: colToIndex(pa[1]),
    r1: pa[2] ? Number(pa[2]) : null,
    c2: colToIndex(pb[1]),
    r2: pb[2] ? Number(pb[2]) : b ? null : pa[2] ? Number(pa[2]) : null,
  };
}

/** Parse "Sheet1!A88:K88" → 88 */
export function firstRowOfRange(r: string | undefined): number | null {
  if (!r) return null;
  const m = /!\$?[A-Z]+\$?(\d+)/i.exec(r);
  return m ? Number(m[1]) : null;
}

class GoogleSheets implements SheetBackend {
  constructor(private id: string) {}
  private base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.id)}`;
  }
  async batchGet(ranges: string[]) {
    const q = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' });
    for (const r of ranges) q.append('ranges', r);
    const res = await googleFetch(`${this.base()}/values:batchGet?${q}`);
    const j = (await res.json()) as { valueRanges?: { values?: string[][] }[] };
    return ranges.map((_, i) => j.valueRanges?.[i]?.values ?? []);
  }
  async batchUpdate(data: { range: string; values: string[][] }[]) {
    await googleFetch(`${this.base()}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
  }
  async append(range: string, values: string[][]) {
    const q = new URLSearchParams({ valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
    const res = await googleFetch(`${this.base()}/values/${encodeURIComponent(range)}:append?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    const j = (await res.json()) as { updates?: { updatedRange?: string } };
    return firstRowOfRange(j.updates?.updatedRange);
  }
  async listTabs() {
    const res = await googleFetch(`${this.base()}?fields=sheets.properties(sheetId,title)`);
    const j = (await res.json()) as { sheets?: { properties: { sheetId: number; title: string } }[] };
    return (j.sheets ?? []).map((s) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
  }
  async addTab(title: string) {
    const res = await googleFetch(`${this.base()}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    const j = (await res.json()) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    return j.replies[0].addSheet.properties.sheetId;
  }
}

/** In-memory spreadsheet used for demo mode and tests. */
export class MemorySheets implements SheetBackend {
  tabs = new Map<string, { sheetId: number; grid: string[][] }>();
  constructor(seed: Record<string, string[][]> = {}) {
    let id = 0;
    for (const [t, g] of Object.entries(seed)) this.tabs.set(t, { sheetId: id++, grid: g.map((r) => [...r]) });
  }
  private tab(name: string) {
    const t = this.tabs.get(name);
    if (!t) throw Object.assign(new Error(`Unable to parse range: ${name}`), { status: 400 });
    return t;
  }
  async batchGet(ranges: string[]) {
    return ranges.map((r) => {
      const p = parseRange(r);
      const g = this.tab(p.tab).grid;
      const r1 = (p.r1 ?? 1) - 1;
      const r2 = p.r2 ? p.r2 - 1 : g.length - 1;
      const out: string[][] = [];
      for (let i = r1; i <= r2 && i < g.length; i++) {
        const row = (g[i] ?? []).slice(p.c1, p.c2 + 1);
        while (row.length && row[row.length - 1] === '') row.pop();
        out.push(row);
      }
      while (out.length && out[out.length - 1].length === 0) out.pop();
      return out;
    });
  }
  async batchUpdate(data: { range: string; values: string[][] }[]) {
    for (const d of data) {
      const p = parseRange(d.range);
      const g = this.tab(p.tab).grid;
      d.values.forEach((vals, ri) => {
        const r = (p.r1 ?? 1) - 1 + ri;
        while (g.length <= r) g.push([]);
        vals.forEach((v, ci) => {
          const c = p.c1 + ci;
          while (g[r].length <= c) g[r].push('');
          g[r][c] = v;
        });
      });
    }
  }
  async append(range: string, values: string[][]) {
    const p = parseRange(range);
    const g = this.tab(p.tab).grid;
    let last = g.length;
    while (last > 0 && (g[last - 1] ?? []).every((c) => !c)) last--;
    const start = last;
    values.forEach((v, i) => {
      const row: string[] = [];
      for (let c = 0; c < p.c1; c++) row.push('');
      g[start + i] = [...row, ...v];
    });
    return start + 1;
  }
  async listTabs() {
    return [...this.tabs.entries()].map(([title, t]) => ({ title, sheetId: t.sheetId }));
  }
  async addTab(title: string) {
    const id = 1000 + this.tabs.size;
    this.tabs.set(title, { sheetId: id, grid: [] });
    return id;
  }
}

const g = globalThis as unknown as { __smprdSheets?: SheetBackend };
export function sheets(): SheetBackend {
  if (!g.__smprdSheets) {
    const c = config();
    if (c.demo) {
      const grid = parseCsv(fs.readFileSync(c.DEMO_SHEET_CSV, 'utf8')).filter((r) => r.some((x) => x !== ''));
      g.__smprdSheets = new MemorySheets({ [c.SHEET_TAB]: grid });
    } else g.__smprdSheets = new GoogleSheets(c.SHEET_ID);
  }
  return g.__smprdSheets;
}
/** Test hook */
export function setSheetsBackend(b: SheetBackend | undefined) {
  g.__smprdSheets = b;
}
