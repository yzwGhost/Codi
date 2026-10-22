import { describe, expect, it } from 'vitest';
import { diffQuota, normalizeRateLimits } from '../src/shared/quota';

const week = { usedPercent: 48, windowDurationMins: 10080, resetsAt: 1793082925 };

describe('normalizeRateLimits', () => {
  it('shows only the weekly window returned by Codex', () => {
    expect(normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: week, secondary: null } })).toEqual([
      { key: 'codex:primary:10080', limitId: 'codex', label: '7 天', usedPercent: 48, remainingPercent: 52, windowDurationMins: 10080, resetsAt: 1793082925 },
    ]);
  });

  it('uses rateLimitsByLimitId without duplicating the fallback bucket', () => {
    const codex = { limitId: 'codex', primary: week, secondary: null };
    const other = { limitId: 'codex_fast', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1793000000 }, secondary: null };
    expect(normalizeRateLimits({ rateLimits: codex, rateLimitsByLimitId: { codex, codex_fast: other } })).toEqual([
      { key: 'codex:primary:10080', limitId: 'codex', label: '7 天', usedPercent: 48, remainingPercent: 52, windowDurationMins: 10080, resetsAt: 1793082925 },
      { key: 'codex_fast:primary:300', limitId: 'codex_fast', label: '5 小时', usedPercent: 10, remainingPercent: 90, windowDurationMins: 300, resetsAt: 1793000000 },
    ]);
  });

  it('uses map keys when valid buckets omit their optional inner limitId', () => {
    expect(normalizeRateLimits({ rateLimits: null, rateLimitsByLimitId: {
      codex: { primary: week, secondary: null },
      codex_fast: { limitId: null, primary: { ...week, usedPercent: 82 }, secondary: null },
    } })).toMatchObject([
      { key: 'codex:primary:10080', limitId: 'codex', remainingPercent: 52 },
      { key: 'codex_fast:primary:10080', limitId: 'codex_fast', remainingPercent: 18 },
    ]);
  });

  it('shows the same bucket and period once even if both slots contain it', () => {
    expect(normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: week, secondary: week } })).toHaveLength(1);
  });

  it('omits null and malformed windows instead of inventing quota', () => {
    const input = { rateLimitsByLimitId: {
      codex: { limitId: 'codex', primary: null, secondary: { usedPercent: 120, windowDurationMins: 300, resetsAt: 1793000000 } },
      other: { limitId: 'other', primary: { usedPercent: '20', windowDurationMins: 300, resetsAt: 1793000000 }, secondary: null },
    } };
    expect(normalizeRateLimits(input)).toEqual([]);
  });
});

describe('diffQuota', () => {
  const before = normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: week } });

  it('animates the exact observed decrease for a matching window', () => {
    const after = normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: { ...week, usedPercent: 50.5 } } });
    expect(diffQuota(before, after, false)).toEqual([{ key: 'codex:primary:10080', amountPercent: 2.5 }]);
  });

  it('does not animate first reads, reconnects, or changed reset windows', () => {
    const after = normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: { ...week, usedPercent: 50 } } });
    const reset = normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: { ...week, usedPercent: 50, resetsAt: week.resetsAt + 10080 * 60 } } });
    expect(diffQuota(null, after, false)).toEqual([]);
    expect(diffQuota(before, after, true)).toEqual([]);
    expect(diffQuota(before, reset, false)).toEqual([]);
  });

  it('rounds display changes and never emits negative zero', () => {
    const after = normalizeRateLimits({ rateLimits: { limitId: 'codex', primary: { ...week, usedPercent: 48.04 } } });
    expect(diffQuota(before, after, false)).toEqual([]);
  });
});
