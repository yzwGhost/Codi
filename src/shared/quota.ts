export type QuotaWindow = {
  key: string;
  limitId: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

export type QuotaDecrease = { key: string; amountPercent: number };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function labelForMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeRateLimits(input: unknown): QuotaWindow[] {
  const response = record(input);
  if (!response) return [];
  const buckets = record(response.rateLimitsByLimitId);
  const source: Array<[string, unknown]> = buckets && Object.keys(buckets).length > 0
    ? Object.entries(buckets)
    : [['', response.rateLimits]];
  const result = new Map<string, QuotaWindow>();
  const seenPeriods = new Set<string>();

  for (const [bucketId, rawBucket] of source) {
    const bucket = record(rawBucket);
    if (!bucket) continue;
    const limitId = bucketId || (typeof bucket.limitId === 'string' && bucket.limitId) || 'codex';
    for (const slot of ['primary', 'secondary'] as const) {
      const window = record(bucket[slot]);
      if (!window) continue;
      const { usedPercent, windowDurationMins, resetsAt } = window;
      if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) continue;
      if (typeof windowDurationMins !== 'number' || !Number.isInteger(windowDurationMins) || windowDurationMins <= 0) continue;
      if (typeof resetsAt !== 'number' || !Number.isInteger(resetsAt) || resetsAt <= 0) continue;
      const period = `${limitId}:${windowDurationMins}`;
      if (seenPeriods.has(period)) continue;
      seenPeriods.add(period);
      const key = `${limitId}:${slot}:${windowDurationMins}`;
      const used = roundPercent(usedPercent);
      result.set(key, {
        key,
        limitId,
        label: labelForMinutes(windowDurationMins),
        usedPercent: used,
        remainingPercent: roundPercent(100 - used),
        windowDurationMins,
        resetsAt,
      });
    }
  }
  return [...result.values()];
}

export function diffQuota(previous: QuotaWindow[] | null, next: QuotaWindow[], reconnect: boolean): QuotaDecrease[] {
  if (!previous || reconnect) return [];
  const before = new Map(previous.map(window => [window.key, window]));
  const decreases: QuotaDecrease[] = [];
  for (const window of next) {
    const prior = before.get(window.key);
    if (!prior || prior.resetsAt !== window.resetsAt) continue;
    const amountPercent = roundPercent(prior.remainingPercent - window.remainingPercent);
    if (amountPercent > 0) decreases.push({ key: window.key, amountPercent });
  }
  return decreases;
}
