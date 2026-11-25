import { normalizeText } from './rows';
import type { Person } from './types';

export const PEOPLE_HEADER = ['Name', 'Sheet spellings', 'Active', 'Added by', 'Added on'];

export function parsePeopleGrid(grid: string[][]): Person[] {
  const out: Person[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const name = (r[0] ?? '').trim();
    if (!name) continue;
    out.push({
      name,
      spellings: (r[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      active: !/^(false|no|0)$/i.test((r[2] ?? 'TRUE').trim()),
      addedBy: r[3] ?? '',
      addedOn: r[4] ?? '',
      sheetRow: i + 1,
    });
  }
  return out;
}

function titleCase(s: string) {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Guess a display name from a raw cell value (name or email). */
export function guessName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.includes('@')) {
    const local = t.split('@')[0].replace(/[0-9]+$/g, '');
    return titleCase(local.replace(/[._+-]+/g, ' ').trim()) || t;
  }
  // ALL CAPS or all lower → Title Case; mixed case kept as typed.
  if (t === t.toUpperCase() || t === t.toLowerCase()) return titleCase(t);
  return t;
}

/** Build initial People rows from distinct Reported By / Bug Owner values. */
export function suggestPeople(values: string[]): Person[] {
  const groups = new Map<string, { name: string; typed: boolean; spellings: Set<string> }>();
  for (const v of values) {
    if (!v || !v.trim()) continue;
    const raw = v.trim().replace(/\s+/g, ' ');
    const name = guessName(raw);
    const k = normalizeText(name);
    const typed = !raw.includes('@');
    const g = groups.get(k) ?? { name, typed: false, spellings: new Set<string>() };
    // prefer a name that was typed (not derived from an email), in its typed casing unless ALL CAPS
    if (typed && (!g.typed || (g.name === g.name.toUpperCase() && raw !== raw.toUpperCase()))) g.name = raw === raw.toUpperCase() ? name : raw;
    g.typed ||= typed;
    g.spellings.add(raw);
    groups.set(k, g);
  }
  // An email-only single word ("renjith@…" → "Renjith") joins the one typed name starting with that word.
  for (const [k, g] of [...groups]) {
    if (g.typed || g.name.includes(' ')) continue;
    const targets = [...groups.values()].filter((t) => t !== g && t.typed && normalizeText(t.name).split(' ')[0] === k);
    if (targets.length === 1) {
      for (const sp of g.spellings) targets[0].spellings.add(sp);
      groups.delete(k);
    }
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, spellings: [...g.spellings].filter((s) => s !== g.name), active: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function sortPeople(p: Person[]) {
  return [...p].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
