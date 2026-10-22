import { diffQuota, normalizeRateLimits } from '../shared/quota';
import { selectPetState, type PetViewState } from '../shared/petState';

type Service = { start(): Promise<void>; stop(): Promise<void> };
type QuotaService = Service & { refresh(): Promise<void> };

export type AppStateDeps = {
  quotaClient: QuotaService;
  activityWatcher: Service;
  publish: (state: PetViewState) => void;
  clock?: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (id: unknown) => void;
  };
};

export function createAppStateController(deps: AppStateDeps) {
  const clock = deps.clock ?? {
    setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
    clearInterval: (id: unknown): void => clearInterval(id as NodeJS.Timeout),
  };
  let state: PetViewState = { windows: null, pet: 'idle', decreases: [], lastUpdatedAt: null, quotaUnavailable: true };
  let isWorking = false;
  let nextEventId = 1;
  let timer: unknown | null = null;

  function emit(): void {
    state = { ...state, pet: selectPetState(state.windows, isWorking) };
    deps.publish(state);
  }

  function onSnapshot(raw: unknown, reconnect: boolean): void {
    const windows = normalizeRateLimits(raw);
    if (windows.length === 0) {
      onUnavailable();
      return;
    }
    const decreases = diffQuota(state.quotaUnavailable ? null : state.windows, windows, reconnect)
      .map(decrease => ({ ...decrease, eventId: nextEventId++ }));
    state = { ...state, windows, decreases, lastUpdatedAt: Date.now(), quotaUnavailable: false };
    emit();
  }

  function onUnavailable(): void {
    state = { ...state, quotaUnavailable: true, decreases: [] };
    emit();
  }

  function onActivity(value: boolean): void {
    isWorking = value;
    state = { ...state, decreases: [] };
    emit();
  }

  function onActivityAvailability(available: boolean): void {
    state = { ...state, activityUnavailable: !available };
    emit();
  }

  async function refresh(): Promise<void> {
    try {
      await deps.quotaClient.refresh();
    } catch {
      onUnavailable();
    }
  }

  return {
    onSnapshot, onUnavailable, onActivity, onActivityAvailability, refresh,
    async start(): Promise<void> {
      emit();
      await deps.activityWatcher.start().catch(() => {});
      await deps.quotaClient.start().catch(() => onUnavailable());
      timer = clock.setInterval(() => { void refresh(); }, 60_000);
    },
    async stop(): Promise<void> {
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
      await Promise.all([deps.activityWatcher.stop(), deps.quotaClient.stop()]);
    },
  };
}
