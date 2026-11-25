import { describe, expect, it } from 'vitest';
import { daysBetween, isoToUk, parseUkDate } from '@/lib/dates';
import { buildPeopleIndex, buildRows, computeStats, gridToRawRows, resolveName, rowKey } from '@/lib/rows';
import { suggestPeople } from '@/lib/people';
import { PEOPLE, fixtureGrid } from './helpers';

const OPEN = ['In progress', 'Feature is Coming soon', 'TBD'];
const build = (today = '2026-11-24') =>
  buildRows(gridToRawRows(fixtureGrid()), { people: PEOPLE, lastChangeByKey: new Map(), mediaByKey: new Map(), stallDays: 14, today });

describe('mapping', () => {
  it('parses UK dates', () => {
    expect(parseUkDate('29/03/2026')).toBe('2026-03-29');
    expect(parseUkDate('4/4/2026')).toBe('2026-04-04');
    expect(parseUkDate('')).toBeNull();
    expect(parseUkDate('31/13/2026')).toBeNull();
    expect(isoToUk('2026-11-24')).toBe('24/11/2026');
  });
  it('builds row keys', () => {
    expect(rowKey('04/04/2026', '  Seller onboarding   pop up window or toast window ')).toBe('2026-04-04|seller onboarding pop up window or toast window');
    expect(rowKey('04/04/2026', 'x'.repeat(100)).split('|')[1]).toHaveLength(60);
  });
  it('uses real sheet row numbers and ignores empty A', () => {
    const grid = fixtureGrid();
    grid.splice(5, 0, ['', 'High', '', 'TBD']);
    const raw = gridToRawRows(grid);
    expect(raw).toHaveLength(86);
    expect(raw[0].rowNumber).toBe(2);
    expect(raw[raw.length - 1].rowNumber).toBe(88);
  });
  it('maps 6 raw spellings to 3 people', () => {
    const raws = new Set(gridToRawRows(fixtureGrid()).flatMap((r) => [r.values[2], r.values[7]]).filter(Boolean));
    expect(raws.size).toBe(6);
    const idx = buildPeopleIndex(PEOPLE);
    const names = new Set([...raws].map((r) => resolveName(r, idx).name));
    expect([...names].sort()).toEqual(['David Thomas', 'Gautham VR', 'Renjith R']);
  });
  it('shows unknown spellings as-is', () => {
    const r = resolveName('someone@else.com', buildPeopleIndex(PEOPLE));
    expect(r).toEqual({ name: 'someone@else.com', known: false });
  });
});

describe('stats (15.2)', () => {
  const rows = build();
  const s = computeStats(rows, OPEN);
  it('totals', () => {
    expect(s.total).toBe(86);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[85].rowNumber).toBe(87);
    expect(s.completed).toBe(66);
    expect(s.completedPct).toBe(77);
  });
  it('status counts', () => {
    expect(s.byStatus).toMatchObject({ Completed: 66, 'Feature existing': 8, 'Feature is Coming soon': 6, 'In progress': 3, 'Feature not needed': 2, TBD: 1 });
    expect(s.other).toBe(0);
  });
  it('still open', () => {
    expect(s.open).toBe(10);
    expect(s.openBreakdown).toEqual({ 'In progress': 3, 'Feature is Coming soon': 6, TBD: 1 });
  });
  it('in progress and stall', () => {
    expect(s.inProgress.count).toBe(3);
    expect(s.inProgress.rows).toEqual([85, 86, 87]);
    expect(s.inProgress.blankOwnerRows).toEqual([85, 86, 87]);
    expect(s.inProgress.stalledRows).toEqual([85, 86, 87]);
    expect(s.inProgress.oldestActivity).toBe('2026-04-04');
    expect(s.inProgress.oldestDays).toBe(234);
    expect(daysBetween('2026-04-04', '2026-11-24')).toBe(234);
  });
  it('completed by priority', () => {
    expect(s.byPriority).toEqual({ High: { done: 6, total: 6 }, Medium: { done: 38, total: 54 }, Low: { done: 22, total: 26 } });
  });
  it('change log activity clears the stall', () => {
    const r = build();
    const k = r.find((x) => x.rowNumber === 85)!.rowKey;
    const rows2 = buildRows(gridToRawRows(fixtureGrid()), { people: PEOPLE, lastChangeByKey: new Map([[k, '2026-11-20']]), mediaByKey: new Map(), stallDays: 14, today: '2026-11-24' });
    expect(rows2.find((x) => x.rowNumber === 85)!.stalled).toBe(false);
    expect(rows2.find((x) => x.rowNumber === 86)!.stalled).toBe(true);
  });
  it('unknown status counts as Other', () => {
    const g = fixtureGrid();
    g[1][3] = 'Waiting on vendor';
    const r = buildRows(gridToRawRows(g), { people: PEOPLE, lastChangeByKey: new Map(), mediaByKey: new Map(), stallDays: 14, today: '2026-11-24' });
    expect(computeStats(r, OPEN).other).toBe(1);
  });
  it('flags duplicates', () => {
    const g = fixtureGrid();
    g.push([...g[1]]);
    const r = buildRows(gridToRawRows(g), { people: PEOPLE, lastChangeByKey: new Map(), mediaByKey: new Map(), stallDays: 14, today: '2026-11-24' });
    expect(r.filter((x) => x.duplicate)).toHaveLength(2);
  });
});

describe('people suggestions for the first setup', () => {
  it('groups name and email spellings', () => {
    const p = suggestPeople(['David Thomas', 'david.thomas@example.com', 'RENJITH R', 'Renjith R', 'renjith.r@example.com', 'gautham.vr@example.com']);
    expect(p.map((x) => x.name)).toEqual(['David Thomas', 'Gautham VR', 'Renjith R']);
    expect(p.find((x) => x.name === 'Renjith R')!.spellings.sort()).toEqual(['RENJITH R', 'renjith.r@example.com'].sort());
  });
});

describe('people suggestions with short emails', () => {
  it('joins an email first name to the one typed full name', () => {
    const p = suggestPeople(['David Thomas', 'david@example.com', 'Renjith R', 'RENJITH R', 'renjith@example.com', 'gautham@example.com']);
    expect(p.map((x) => x.name)).toEqual(['David Thomas', 'Gautham', 'Renjith R']);
    expect(p.find((x) => x.name === 'David Thomas')!.spellings).toEqual(['david@example.com']);
  });
});
