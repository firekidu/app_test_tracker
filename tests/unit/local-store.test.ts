import { describe, expect, it } from 'vitest';
import { SqliteSheets, rng } from '@/lib/google/sheets';
import { csvToRows } from '@/lib/sheet-store';
import { db } from '@/lib/db';

describe('standalone storage (SQLite)', () => {
  it('persists tabs across instances', async () => {
    db().exec('DROP TABLE IF EXISTS sheet_tabs');
    const a = new SqliteSheets();
    await a.addTab('Sheet1');
    await a.batchUpdate([{ range: rng('Sheet1', 'A1:B1'), values: [['Bugs', 'Priority']] }]);
    const n = await a.append(rng('Sheet1', 'A:B'), [['First bug', 'High']]);
    expect(n).toBe(2);
    const b = new SqliteSheets(); // simulates a restart
    const [grid] = await b.batchGet([rng('Sheet1', 'A1:B')]);
    expect(grid).toEqual([['Bugs', 'Priority'], ['First bug', 'High']]);
    await b.replaceGrid('Sheet1', [['Bugs']]);
    const c = new SqliteSheets();
    expect((await c.batchGet([rng('Sheet1', 'A1:B')]))[0]).toEqual([['Bugs']]);
  });
});

describe('CSV import mapping', () => {
  it('maps columns by header name and normalises dates', () => {
    const rows = csvToRows([
      ['Status', 'Bugs', 'Reported Date', 'Bug Owner', 'Extra'],
      ['TBD', 'Login fails', '4/4/2026', 'Renjith R', 'x'],
      ['', '', '', '', ''],
      ['Completed', '', '01/01/2026', '', ''],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 8)).toEqual(['Login fails', '', '', 'TBD', '04/04/2026', '', '', 'Renjith R']);
  });
  it('needs a Bugs column', () => {
    expect(() => csvToRows([['Title?'], ['x']])).toThrow(/Bugs/);
  });
});
