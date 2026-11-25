import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '@/lib/csv';
import type { Person } from '@/lib/types';

export function fixtureGrid(): string[][] {
  return parseCsv(fs.readFileSync(path.resolve(__dirname, '../fixtures/sheet-2026-11-24.csv'), 'utf8')).filter((r) => r.some(Boolean));
}

export const PEOPLE: Person[] = [
  { name: 'David Thomas', spellings: ['david@example.com'], active: true },
  { name: 'Renjith R', spellings: ['RENJITH R', 'renjith@example.com'], active: true },
  { name: 'Gautham VR', spellings: ['gautham@example.com'], active: true },
];
