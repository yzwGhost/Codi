import { expect, it } from 'vitest';
import { selectPetState } from '../src/shared/petState';
import type { QuotaWindow } from '../src/shared/quota';

const quota = (remainingPercent: number): QuotaWindow => ({
  key: 'codex:primary:10080', limitId: 'codex', label: '7 天', usedPercent: 100 - remainingPercent,
  remainingPercent, windowDurationMins: 10080, resetsAt: 1793082925,
});

it('shows low quota before work or idle at the 20 percent boundary', () => {
  expect(selectPetState([quota(20)], true)).toBe('low');
  expect(selectPetState([quota(20)], false)).toBe('low');
  expect(selectPetState([quota(20.1)], true)).toBe('working');
  expect(selectPetState([quota(20.1)], false)).toBe('idle');
});

it('does not treat unavailable quota as depleted', () => {
  expect(selectPetState(null, true)).toBe('working');
  expect(selectPetState([], false)).toBe('idle');
});
