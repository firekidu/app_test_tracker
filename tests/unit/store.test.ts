import { beforeEach, describe, expect, it } from 'vitest';
import { MemorySheets, setSheetsBackend } from '@/lib/google/sheets';
import { CHANGELOG_HEADER, addRow, deleteRow, diffSnapshots, snapshot, sync, updateRow } from '@/lib/sheet-store';
import { gridToRawRows, rowKey } from '@/lib/rows';
import { PEOPLE_HEADER } from '@/lib/people';
import { fixtureGrid } from './helpers';

const actor = { username: 'david', displayName: 'David Thomas', personName: 'David Thomas', role: 'admin' };
let mem: MemorySheets;

function fresh() {
  const g = globalThis as unknown as { __smprdStore?: unknown };
  g.__smprdStore = undefined;
  const grid = fixtureGrid();
  grid[0].push('Media');
  mem = new MemorySheets({
    Sheet1: grid,
    'Change log': [CHANGELOG_HEADER],
    People: [PEOPLE_HEADER, ['David Thomas', 'david@example.com', 'TRUE'], ['Renjith R', 'RENJITH R, renjith@example.com', 'TRUE'], ['Gautham VR', 'gautham@example.com', 'TRUE']],
  });
  setSheetsBackend(mem);
}

describe('sheet store (4.6 row identity, M2 edits)', () => {
  beforeEach(fresh);

  it('loads the snapshot with people mapping', async () => {
    const s = await snapshot();
    expect(s.rows).toHaveLength(86);
    expect(s.stats.completedPct).toBe(77);
    expect(new Set(s.rows.flatMap((r) => [r.reporter, r.owner]).filter(Boolean))).toEqual(new Set(['David Thomas', 'Renjith R', 'Gautham VR']));
  });

  it('same key → writes; Completed fills End date; two log lines', async () => {
    const s = await snapshot();
    const r85 = s.rows.find((r) => r.rowNumber === 85)!;
    const res = await updateRow(85, r85.rowKey, { status: 'Completed' }, actor);
    expect(res.rowNumber).toBe(85);
    expect(res.changed.map((c) => c.field)).toEqual(['Status', 'End date']);
    const g = mem.tabs.get('Sheet1')!.grid;
    expect(g[84][3]).toBe('Completed');
    expect(g[84][5]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(mem.tabs.get('Change log')!.grid.length).toBe(3);
    const s2 = await snapshot();
    expect(s2.stats.completed).toBe(67);
  });

  it('moved row → found once → writes to the new row', async () => {
    const s = await snapshot();
    const r86 = s.rows.find((r) => r.rowNumber === 86)!;
    // Someone inserts a row above it in Google Sheets.
    const g = mem.tabs.get('Sheet1')!.grid;
    g.splice(2, 0, ['Inserted in Sheets', 'Low', 'David Thomas', 'TBD', '01/03/2026', '', '', '', '', '', '']);
    const res = await updateRow(86, r86.rowKey, { owner: 'Gautham VR' }, actor);
    expect(res.movedFrom).toBe(86);
    expect(res.rowNumber).toBe(87);
    expect(g[86][7]).toBe('Gautham VR');
  });

  it('duplicate key → 409', async () => {
    const g = mem.tabs.get('Sheet1')!.grid;
    g.push([...g[1]]);
    await sync();
    const key = rowKey(g[1][4], g[1][0]);
    await expect(updateRow(2, key, { priority: 'High' }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it('row gone → 409', async () => {
    await snapshot();
    await expect(updateRow(5, '2020-01-01|nope', { priority: 'High' }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects names not in People', async () => {
    const s = await snapshot();
    const r = s.rows[0];
    await expect(updateRow(r.rowNumber, r.rowKey, { owner: 'Stranger' }, actor)).rejects.toMatchObject({ status: 422 });
  });

  it('edits text and dates; rejects malformed dates', async () => {
    const s = await snapshot();
    const r = s.rows.find((x) => x.rowNumber === 20)!;
    await expect(updateRow(20, r.rowKey, { endDate: '19/02/202603/12/2026' }, actor)).rejects.toMatchObject({ status: 422 });
    const res = await updateRow(20, r.rowKey, { endDate: '3/12/2026', milestone: 'M9', notes: 'n1' }, actor);
    expect(res.changed.map((c) => c.field).sort()).toEqual(['End date', 'Milestone', 'Notes']);
    expect(mem.tabs.get('Sheet1')!.grid[19][5]).toBe('03/12/2026');
    const after = (await snapshot()).rows.find((x) => x.rowNumber === 20)!;
    expect(after.edits['Milestone'].by).toBe('David Thomas (david)');
    expect(after.edits['Milestone'].at).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it('deletes a row; rows below move up; logged', async () => {
    const s = await snapshot();
    const r5 = s.rows.find((x) => x.rowNumber === 5)!;
    const r6title = s.rows.find((x) => x.rowNumber === 6)!.title;
    const res = await deleteRow(5, r5.rowKey, actor);
    expect(res.rowNumber).toBe(5);
    const s2 = await snapshot();
    expect(s2.rows).toHaveLength(85);
    expect(s2.rows.find((x) => x.rowNumber === 5)!.title).toBe(r6title);
    expect(mem.tabs.get('Change log')!.grid.at(-1)![4]).toBe('Row deleted');
  });

  it('adds a row', async () => {
    await snapshot();
    const r = await addRow({ title: 'New bug from the app', priority: 'Medium', status: 'TBD', reporter: 'David Thomas', owner: '', notes: 'n' }, actor);
    expect(r.rowNumber).toBe(88);
    const s = await snapshot();
    expect(s.rows).toHaveLength(87);
  });

  it('detects edits made directly in Google Sheets', () => {
    const prev = gridToRawRows(fixtureGrid());
    const nextGrid = fixtureGrid();
    nextGrid[84][3] = 'Completed';
    const lines = diffSnapshots(prev, gridToRawRows(nextGrid), 'Europe/London');
    expect(lines).toHaveLength(1);
    expect(lines[0][4]).toBe('Status');
    expect(lines[0][8]).toBe('Sheet (outside app)');
    expect(lines[0][7]).toBe('—');
  });
});
