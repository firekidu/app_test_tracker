import { describe, expect, it } from 'vitest';
import { clearFailures, lockState, recordFailure } from '@/lib/lockout';

describe('lock-out', () => {
  it('locks after 5 failures within 15 minutes and resets on success', () => {
    const u = 'locktest';
    const t0 = Date.parse('2026-11-24T10:00:00Z');
    for (let i = 0; i < 4; i++) expect(recordFailure(u, t0 + i * 1000)).toBe(false);
    expect(lockState(u, t0 + 5000).locked).toBe(false);
    expect(recordFailure(u, t0 + 5000)).toBe(true);
    expect(lockState(u, t0 + 6000).locked).toBe(true);
    // still locked 14 minutes later
    expect(lockState(u, t0 + 14 * 60_000).locked).toBe(true);
    // unlocked after 15 minutes
    expect(lockState(u, t0 + 5000 + 15 * 60_000 + 1).locked).toBe(false);
    clearFailures(u);
    expect(lockState(u, t0).locked).toBe(false);
  });
  it('restarts the count after the window', () => {
    const u = 'windowtest';
    const t0 = Date.parse('2026-11-24T10:00:00Z');
    for (let i = 0; i < 4; i++) recordFailure(u, t0 + i);
    expect(recordFailure(u, t0 + 16 * 60_000)).toBe(false); // counter restarted
  });
});
