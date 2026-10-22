// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { renderPetView } from '../src/renderer/main';
import type { PetViewState } from '../src/shared/petState';

const windowA = { key: 'codex:primary:300', limitId: 'codex', label: '5 小时', usedPercent: 30, remainingPercent: 70, windowDurationMins: 300, resetsAt: 1_800_000_000 };
const windowB = { key: 'codex:secondary:10080', limitId: 'codex', label: '7 天', usedPercent: 82, remainingPercent: 18, windowDurationMins: 10080, resetsAt: 1_800_500_000 };
const state = (overrides: Partial<PetViewState> = {}): PetViewState => ({
  windows: [windowA], pet: 'working', decreases: [], lastUpdatedAt: Date.now(), quotaUnavailable: false, ...overrides,
});

beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; });

it('shows each real quota window, percent, and local reset time', () => {
  renderPetView(state({ windows: [windowA, windowB] }), document.getElementById('app')!);
  expect(document.querySelectorAll('.quota-row')).toHaveLength(2);
  expect(document.body.textContent).toContain('70%');
  expect(document.body.textContent).toContain('18%');
  expect(document.body.textContent).toContain('5 小时');
  expect(document.body.textContent).toContain('7 天');
  expect(document.body.textContent).toContain('重置');
});

it('shows only returned windows and an unavailable message with last success time', () => {
  renderPetView(state({ windows: [], quotaUnavailable: true, lastUpdatedAt: 1_800_000_000_000 }), document.getElementById('app')!);
  expect(document.querySelectorAll('.quota-row')).toHaveLength(0);
  expect(document.body.textContent).toContain('额度暂不可用');
  expect(document.body.textContent).toContain('上次更新');
});

it.each(['working', 'idle', 'low'] as const)('selects the %s image', pet => {
  renderPetView(state({ pet }), document.getElementById('app')!);
  expect((document.querySelector('.pet-image') as HTMLImageElement).src).toContain(`pet-${pet}.png`);
});

it('animates the matching decrease exactly once for the same event ID', () => {
  const root = document.getElementById('app')!;
  const changed = state({ windows: [windowA, windowB], decreases: [{ key: windowB.key, amountPercent: 2.5, eventId: 8 }] });
  renderPetView(changed, root);
  expect(document.querySelectorAll('.quota-decrease')).toHaveLength(1);
  expect(document.querySelector('.quota-decrease')?.textContent).toBe('-2.5%');
  expect(document.querySelector('[data-key="codex:secondary:10080"] .quota-decrease')).not.toBeNull();
  renderPetView(changed, root);
  expect(document.querySelectorAll('.quota-decrease')).toHaveLength(0);
});
