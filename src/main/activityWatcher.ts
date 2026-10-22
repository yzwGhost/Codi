import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export type ActivityWatcherOptions = {
  codexHome: string;
  onChange: (isWorking: boolean) => void;
  onAvailabilityChange?: (available: boolean) => void;
  isDesktopRunning: () => Promise<boolean>;
  scanIntervalMs?: number;
};

function activeDesktopTurn(home: string, nowMs: number): { working: boolean; available: boolean } {
  let history: DatabaseSync | null = null;
  let state: DatabaseSync | null = null;
  try {
    history = new DatabaseSync(join(home, 'thread_history_1.sqlite'), { readOnly: true });
    state = new DatabaseSync(join(home, 'state_5.sqlite'), { readOnly: true });
    // A crash may leave an unfinished turn behind. Limit the startup query to
    // recent work without reading prompts, responses, or other session content.
    const cutoff = Math.floor(nowMs / 1000) - 24 * 60 * 60;
    const rows = history.prepare(
      "SELECT DISTINCT thread_id FROM thread_turns WHERE status = 'inProgress' AND completed_at IS NULL AND started_at >= ?"
    ).all(cutoff) as Array<{ thread_id: string }>;
    const desktop = state.prepare("SELECT 1 FROM threads WHERE id = ? AND originator = 'Codex Desktop' LIMIT 1");
    return { working: rows.some(row => desktop.get(row.thread_id) !== undefined), available: true };
  } catch {
    // The index is private Codex Desktop storage and may be absent or change
    // schema. Unavailable activity is idle; quota polling remains independent.
    return { working: false, available: false };
  } finally {
    state?.close();
    history?.close();
  }
}

export function createActivityWatcher(options: ActivityWatcherOptions) {
  let interval: NodeJS.Timeout | null = null;
  let scanPromise: Promise<void> | null = null;
  let stopped = true;
  let wasWorking = false;
  let wasAvailable: boolean | null = null;

  async function scan(): Promise<void> {
    const running = await options.isDesktopRunning().catch(() => false);
    if (stopped) return;
    const result = running ? activeDesktopTurn(options.codexHome, Date.now()) : { working: false, available: true };
    if (result.available !== wasAvailable) {
      wasAvailable = result.available;
      options.onAvailabilityChange?.(result.available);
    }
    const working = result.working;
    if (working !== wasWorking) {
      wasWorking = working;
      options.onChange(working);
    }
  }

  function requestScan(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (scanPromise) return scanPromise;
    scanPromise = scan().finally(() => { scanPromise = null; });
    return scanPromise;
  }

  return {
    async start(): Promise<void> {
      if (!stopped) return;
      stopped = false;
      await requestScan();
      interval = setInterval(() => { void requestScan(); }, options.scanIntervalMs ?? 5_000);
    },
    async stop(): Promise<void> {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = null;
      await scanPromise;
    },
  };
}
