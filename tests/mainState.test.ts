import { expect, it } from 'vitest';
import { createAppStateController } from '../src/main/appState';
import type { PetViewState } from '../src/shared/petState';

const raw = (used: number) => ({ rateLimits: { limitId: 'codex', primary: { usedPercent: used, windowDurationMins: 300, resetsAt: 1_800_000_000 } } });

function fixture(failStart = false) {
  const published: PetViewState[] = [];
  let tick: (() => void) | null = null;
  const calls: string[] = [];
  const quotaClient = {
    start: async () => { calls.push('quota-start'); if (failStart) throw new Error('offline'); },
    refresh: async () => { calls.push('refresh'); },
    stop: async () => { calls.push('quota-stop'); },
  };
  const activityWatcher = {
    start: async () => { calls.push('activity-start'); },
    stop: async () => { calls.push('activity-stop'); },
  };
  const controller = createAppStateController({
    quotaClient, activityWatcher, publish: state => published.push(state),
    clock: { setInterval: (fn, ms) => { expect(ms).toBe(60_000); tick = fn; return 1; }, clearInterval: () => { tick = null; } },
  });
  return { controller, published, calls, fireTick: () => tick?.() };
}

it('prioritizes low quota over active work and emits only an observed decrease', async () => {
  const f = fixture();
  await f.controller.start();
  f.controller.onActivity(true);
  f.controller.onSnapshot(raw(70), false);
  expect(f.published.at(-1)?.pet).toBe('working');
  expect(f.published.at(-1)?.decreases).toEqual([]);
  f.controller.onSnapshot(raw(81), false);
  expect(f.published.at(-1)?.pet).toBe('low');
  expect(f.published.at(-1)?.decreases[0]).toMatchObject({ amountPercent: 11, eventId: 1 });
  f.controller.onActivity(false);
  expect(f.published.at(-1)?.pet).toBe('low');
  f.controller.onSnapshot(raw(60), true);
  expect(f.published.at(-1)?.pet).toBe('idle');
  expect(f.published.at(-1)?.decreases).toEqual([]);
  await f.controller.stop();
});

it('keeps last success time on failure and resets the animation baseline on recovery', async () => {
  const f = fixture(true);
  await f.controller.start();
  expect(f.published.at(-1)?.quotaUnavailable).toBe(true);
  f.controller.onSnapshot(raw(50), false);
  const lastUpdatedAt = f.published.at(-1)?.lastUpdatedAt;
  f.controller.onUnavailable();
  expect(f.published.at(-1)?.lastUpdatedAt).toBe(lastUpdatedAt);
  expect(f.published.at(-1)?.quotaUnavailable).toBe(true);
  f.controller.onSnapshot(raw(60), false);
  expect(f.published.at(-1)?.decreases).toEqual([]);
  expect(f.published.at(-1)?.quotaUnavailable).toBe(false);
  f.fireTick();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.calls).toContain('refresh');
  await f.controller.stop();
  expect(f.calls).toContain('activity-stop');
  expect(f.calls).toContain('quota-stop');
});

it('treats a malformed quota snapshot as unavailable instead of showing an empty card', async () => {
  const f = fixture();
  await f.controller.start();
  f.controller.onSnapshot(raw(40), false);
  const last = f.published.at(-1)?.lastUpdatedAt;
  f.controller.onSnapshot({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 'bad' } } } }, false);
  expect(f.published.at(-1)?.quotaUnavailable).toBe(true);
  expect(f.published.at(-1)?.lastUpdatedAt).toBe(last);
  await f.controller.stop();
});

it('reports task-index failure separately from quota availability', async () => {
  const f = fixture();
  await f.controller.start();
  f.controller.onSnapshot(raw(40), false);
  f.controller.onActivityAvailability(false);
  expect(f.published.at(-1)?.activityUnavailable).toBe(true);
  expect(f.published.at(-1)?.quotaUnavailable).toBe(false);
  await f.controller.stop();
});
