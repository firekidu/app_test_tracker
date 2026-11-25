import { describe, expect, it } from 'vitest';
import { buildPeopleIndex, findPersonClash, resolveName, validatePersonName } from '@/lib/rows';
import { PEOPLE } from './helpers';

describe('names (5.13)', () => {
  it('matches ignoring case and extra spaces', () => {
    expect(resolveName('renjith  r', buildPeopleIndex(PEOPLE))).toEqual({ name: 'Renjith R', known: true });
  });
  it('detects clashes with names and spellings', () => {
    expect(findPersonClash('New Person', ['renjith@example.com'], PEOPLE)?.name).toBe('Renjith R');
    expect(findPersonClash('RENJITH R', [], PEOPLE)?.name).toBe('Renjith R');
    expect(findPersonClash('Anita K', [], PEOPLE)).toBeNull();
  });
  it('validates new names', () => {
    expect(validatePersonName('anita@example.com')).toMatch(/email/i);
    expect(validatePersonName('A')).toMatch(/2–60/);
    expect(validatePersonName("Mary-Jane O'Neil Jr.")).toBeNull();
    expect(validatePersonName('Bad<script>')).not.toBeNull();
  });
});
