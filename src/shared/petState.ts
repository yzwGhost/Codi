import type { QuotaDecrease, QuotaWindow } from './quota';

export type PetState = 'working' | 'idle' | 'low';
export type PetViewState = {
  windows: QuotaWindow[] | null;
  pet: PetState;
  decreases: Array<QuotaDecrease & { eventId: number }>;
  lastUpdatedAt: number | null;
  quotaUnavailable: boolean;
};

export function selectPetState(windows: QuotaWindow[] | null, isWorking: boolean): PetState {
  if (windows?.some(window => window.remainingPercent <= 20)) return 'low';
  return isWorking ? 'working' : 'idle';
}
