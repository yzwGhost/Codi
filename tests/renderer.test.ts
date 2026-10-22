// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { renderPetView } from '../src/renderer/main';
import type { PetViewState } from '../src/shared/petState';

const windowA = { key: 'codex:primary:300', limitId: 'codex', label: '5 小时', usedPercent: 30, remainingPercent: 70, windowDurationMins: 300, resetsAt: 1_800_000_000 };
const windowB = { key: 'codex:secondary:10080', limitId: 'codex', label: '7 天', usedPercent: 82, remainingPercent: 18, windowDurationMins: 10080, resetsAt: 1_800_500_000 };
const state = (overrides: Partial<PetViewState> = {}): PetViewState => ({
  windows: [windowA], pet: 'working', decreases: [], lastUpdatedAt: Date.now(), quotaUnavailable: false, ...overrides,
});

beforeEach(() => { document.body.innerHTML = '<main id="app"></main>'; });

it('shows only progress bars and percentages below the image, with details on hover', () => {
  renderPetView(state({ windows: [windowA, windowB] }), document.getElementById('app')!);
  expect(document.querySelectorAll('.quota-row')).toHaveLength(2);
  expect(document.body.textContent).toContain('70%');
  expect(document.body.textContent).toContain('18%');
  expect(document.body.textContent).not.toContain('Codex 额度');
  expect(document.body.textContent).not.toContain('重置');
  expect(document.querySelector('.pet-image')?.nextElementSibling?.classList.contains('quota-card')).toBe(true);
  expect(document.querySelector('[data-key="codex:secondary:10080"]')?.getAttribute('title')).toContain('7 天');
  expect(document.querySelector('[data-key="codex:secondary:10080"]')?.getAttribute('title')).toContain('重置');
  expect((document.querySelector('[data-key="codex:secondary:10080"] .quota-fill') as HTMLElement).style.width).toBe('18%');
});

it('shows only returned windows and an unavailable message with last success time', () => {
  renderPetView(state({ windows: [], quotaUnavailable: true, lastUpdatedAt: 1_800_000_000_000 }), document.getElementById('app')!);
  expect(document.querySelectorAll('.quota-row')).toHaveLength(0);
  expect(document.body.textContent).toContain('额度暂不可用');
  expect(document.querySelector('.quota-card')?.getAttribute('title')).toContain('上次更新');
});

it('shows a task-state diagnostic while keeping quota visible', () => {
  renderPetView(state({ activityUnavailable: true }), document.getElementById('app')!);
  expect(document.querySelector('.quota-card')?.getAttribute('title')).toContain('任务状态暂不可用');
  expect(document.body.textContent).toContain('70%');
});

it('opens the desktop menu only when the character image is right-clicked', () => {
  const showPetMenu = vi.fn();
  window.petBridge = { onState: vi.fn(), refreshQuota: vi.fn(), setAutostart: vi.fn(), showPetMenu, movePet: vi.fn() };
  const root = document.getElementById('app')!;
  renderPetView(state(), root);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.querySelector('.pet-image')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(showPetMenu).toHaveBeenCalledOnce();
  root.querySelector('.quota-card')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(showPetMenu).toHaveBeenCalledOnce();
});

it('drags the pet from the image with the left pointer button', () => {
  const movePet = vi.fn();
  window.petBridge = { onState: vi.fn(), refreshQuota: vi.fn(), setAutostart: vi.fn(), showPetMenu: vi.fn(), movePet };
  renderPetView(state(), document.getElementById('app')!);
  const image = document.querySelector('.pet-image')!;
  image.dispatchEvent(new MouseEvent('pointerdown', { button: 0, screenX: 100, screenY: 100 }));
  image.dispatchEvent(new MouseEvent('pointermove', { screenX: 120, screenY: 110 }));
  expect(movePet).toHaveBeenCalledWith(20, 10);
  image.dispatchEvent(new MouseEvent('pointerup'));
  image.dispatchEvent(new MouseEvent('pointermove', { screenX: 135, screenY: 120 }));
  expect(movePet).toHaveBeenCalledTimes(1);
});

it('applies the selected size to the character and quota strip together', () => {
  const root = document.getElementById('app')!;
  renderPetView(state({ sizeScale: 1.25 }), root);
  expect(root.style.getPropertyValue('--pet-scale')).toBe('1.25');
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
