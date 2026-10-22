# Codex Quota Desktop Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop pet that shows ChatGPT Codex quota beside the supplied character, animates observed quota decreases, and switches between working, idle, and low-quota art.

**Architecture:** An Electron main process owns a Codex App Server JSON-RPC client and a read-only Codex Desktop session watcher. A small shared state model normalizes their outputs; a sandboxed renderer displays the three PNGs, quota card, and animation through a narrow preload bridge.

**Tech Stack:** Electron, TypeScript, Vite for the renderer, Vitest for logic/protocol tests, electron-builder for a Windows installer. No UI framework is required for this single-window app.

**Spec:** `docs/superpowers/specs/2026-10-22-codex-quota-desktop-pet-design.md`

## Global Constraints

- Windows desktop app; work-state monitoring covers this computer's Codex Desktop only. Quota is the account-wide ChatGPT Codex allowance, so use elsewhere can also cause a decrease; it is not OpenAI API billing.
- Use Node.js 22 for development and builds, as requested by the user.
- Use the user's three original transparent PNGs for A (working), B (idle), and C (low quota); preserve their content and alpha.
- Show available quota windows continuously; threshold for C is remaining `≤20%` in any displayed window.
- Show one `-X%` animation per observed decrease of a matching quota window; first read, reset, new bucket, and reconnect establish a baseline without an animation.
- Read quota through `codex app-server` `account/rateLimits/read`, with 60-second refresh and update notifications; never parse `auth.json` or log tokens.
- Detect work from local session JSONL with `session_meta.originator === "Codex Desktop"` and task events; do not process conversation text for product behavior.
- The window is transparent, always on top, draggable, remembers position, and supports tray hide/show, manual refresh, optional autostart, and explicit quit.

## Review Focus

1. A response containing only a weekly window or null `primary`/`secondary` must show only actual windows; Task 1 tests this.
2. Duplicate buckets, malformed percentages, and a changed `resetsAt` must not create a false `-X%`; Task 1 tests this.
3. Split JSONL lines, an unrelated CLI session, and two simultaneous Desktop sessions must not misclassify work; Task 3 tests this.
4. App Server stdout may split or combine JSON messages and can close during a request; Task 2 tests parsing, pending-request rejection, and reconnect.
5. A saved window position can be outside the current display after unplugging a monitor; Task 5 tests clamping to visible work area.

---

## File Map

- `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `electron-builder.yml`: scripts, builds, test runner, Windows packaging.
- `src/shared/quota.ts`: normalize rate-limit buckets, calculate remaining values and change events.
- `src/shared/petState.ts`: resolve A/B/C image state from quota and activity; define the serializable renderer state.
- `src/main/codexExecutable.ts`: find an installed `codex.exe` without a shell or credential access.
- `src/main/codexQuotaClient.ts`: stdio JSON-RPC handshake, quota requests, notifications, reconnect lifecycle.
- `src/main/activityWatcher.ts`: incremental, read-only Desktop session event parsing and aggregate activity.
- `src/main/appState.ts`, `src/main/windowState.ts`: service state/scheduling and saved position validation.
- `src/main/main.ts`, `src/main/preload.ts`: Electron window, tray, autostart, limited IPC, service orchestration.
- `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/style.css`: pet and quota card.
- `assets/pet-working.png`, `assets/pet-idle.png`, `assets/pet-low.png`: copied user images.
- `tests/*.test.ts`: focused behavior and protocol tests alongside the owning tasks.

### Task 1: Quota and Pet State Model

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/shared/quota.ts`, `src/shared/petState.ts`, `tests/quota.test.ts`, `tests/petState.test.ts`.

**Interfaces:**
- `normalizeRateLimits(input: unknown): QuotaWindow[]`, where `QuotaWindow = { key: string; limitId: string; label: string; usedPercent: number; remainingPercent: number; windowDurationMins: number; resetsAt: number }`.
- `diffQuota(previous: QuotaWindow[] | null, next: QuotaWindow[], reconnect: boolean): QuotaDecrease[]`, where `QuotaDecrease = { key: string; amountPercent: number }`.
- `selectPetState(windows: QuotaWindow[] | null, isWorking: boolean): "working" | "idle" | "low"`.
- `PetViewState = { windows: QuotaWindow[] | null; pet: "working" | "idle" | "low"; decreases: Array<QuotaDecrease & { eventId: number }>; lastUpdatedAt: number | null; quotaUnavailable: boolean }` is the serializable IPC payload. The controller assigns increasing `eventId` values so a rerender cannot replay an old animation.
- `key` is stable for the same `limitId`, slot (`primary`/`secondary`), and duration. `label` uses the actual window duration; no fixed 5-hour or weekly assumption.

- [ ] **Step 1: Bootstrap the minimal TypeScript/Vitest package and install dependencies; write failing tests** for a weekly-only response, null slots, two different limit IDs, duplicate `rateLimits`/`rateLimitsByLimitId` data, malformed or out-of-range percentages, quota decline, reset timestamp change, first read, reconnect, rounding without `-0%`, and C > A > B priority. Assert exact output arrays and decrease amounts.
- [ ] **Step 2: Run `npm test -- --run tests/quota.test.ts tests/petState.test.ts`**; expect failure because the functions do not exist.
- [ ] **Step 3: Implement the exact three functions and types** in `src/shared/quota.ts` and `src/shared/petState.ts`. Reject nonfinite or out-of-range percentages rather than inventing a valid value. Compare changes only when keys and `resetsAt` match.
- [ ] **Step 4: Run `npm test -- --run tests/quota.test.ts tests/petState.test.ts`**; expect all Task 1 tests to pass.
- [ ] **Step 5: Commit** the Task 1 files with `feat: model quota and pet states`.

### Task 2: Codex App Server Quota Client

**Files:** Create `src/main/codexExecutable.ts`, `src/main/codexQuotaClient.ts`, `tests/codexQuotaClient.test.ts`; update `package.json` only for required build or test dependencies.

**Interfaces:**
- `resolveCodexExecutable(candidates?: string[]): Promise<string>` finds `codex.exe` from explicit candidates, `where.exe codex.exe`, then `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`; throw a user-readable error if absent. Never spawn a `.cmd` shim with a shell.
- `createCodexQuotaClient(options: { executable: string; onSnapshot: (raw: unknown, reconnect: boolean) => void; onUnavailable: (reason: string) => void; spawnProcess?: (exe: string, args: string[]) => ChildProcessWithoutNullStreams }): { start(): Promise<void>; refresh(): Promise<void>; stop(): Promise<void> }`. `spawnProcess` is test injection; production uses Node's `spawn` with `shell: false`.
- The client emits raw rate-limit results; Task 1 owns normalization. The Electron orchestrator in Task 5 owns the 60-second refresh timer.

- [ ] **Step 1: Write failing tests** with an injected fake child-process transport: split and combined JSONL responses, initialize/initialized ordering, `account/read` followed by `account/rateLimits/read`, update notification triggering a new snapshot, a request rejected on process exit, clean stop, and path resolution with spaces/missing executable. Assert that no auth-file read or token is needed.
- [ ] **Step 2: Run `npm test -- --run tests/codexQuotaClient.test.ts`**; expect failure because the client and resolver do not exist.
- [ ] **Step 3: Implement `resolveCodexExecutable` and `createCodexQuotaClient`**. Use `spawn(executable, ["app-server", "--listen", "stdio://"], { shell: false })`; buffer stdout by newline, correlate request IDs, ignore unrelated notifications, bound request timeouts, reject pending requests on exit, and reconnect with bounded backoff. Keep stderr diagnostics free of credentials.
- [ ] **Step 4: Run `npm test -- --run tests/codexQuotaClient.test.ts`**; expect all Task 2 tests to pass. Make one read-only live `account/rateLimits/read` probe with the installed Codex executable and confirm the response shape without printing account identifiers or tokens.
- [ ] **Step 5: Commit** the Task 2 files with `feat: read Codex quota through app server`.

### Task 3: Local Codex Desktop Activity Watcher

**Files:** Create `src/main/activityWatcher.ts`, `tests/activityWatcher.test.ts`.

**Interfaces:**
- `parseSessionLine(line: string): { kind: "meta"; isDesktop: boolean } | { kind: "started" | "completed" } | null` reads only the event type and `session_meta.originator`.
- `createActivityWatcher(options: { sessionsDir: string; onChange: (isWorking: boolean) => void; isDesktopRunning: () => Promise<boolean> }): { start(): Promise<void>; stop(): Promise<void> }` aggregates Desktop session states. It watches new and appended JSONL files, reconciles every 5 seconds, and ignores incomplete sessions older than 120 seconds on startup. `isDesktopRunning` is injectable for tests.

- [ ] **Step 1: Write failing tests** for `originator: Codex Desktop`, unrelated CLI and IDE sessions, split lines on append, two concurrent Desktop sessions, completion of only one session, stale incomplete session at startup, malformed JSON, missing directory, and Codex Desktop process exit. Assert only true activity transitions reach `onChange`.
- [ ] **Step 2: Run `npm test -- --run tests/activityWatcher.test.ts`**; expect failure because the parser and watcher do not exist.
- [ ] **Step 3: Implement parser and watcher** with read-only incremental offsets and per-file line buffers. Inspect only recent Desktop files on startup; maintain per-session started/completed state. Use a periodic scan as a fallback for dropped Windows file-watch events. Do not expose or log task text.
- [ ] **Step 4: Run `npm test -- --run tests/activityWatcher.test.ts`**; expect all Task 3 tests to pass. Start and finish one real Codex Desktop turn and verify the watcher reports `true` then `false`.
- [ ] **Step 5: Commit** the Task 3 files with `feat: detect active Codex Desktop tasks`.

### Task 4: Pet Renderer and Quota Card

**Files:** Create `assets/pet-working.png`, `assets/pet-idle.png`, `assets/pet-low.png`, `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/style.css`, `vite.config.ts`, `tests/renderer.test.ts`; update package build scripts.

**Interfaces:**
- `renderPetView(state: PetViewState): void` renders from the shared type and remembers the last animated `eventId` per quota row.
- Preload bridge consumed from Task 5: `window.petBridge.onState(callback): () => void` and `window.petBridge.refreshQuota(): Promise<void>`.

- [ ] **Step 1: Write failing DOM tests** for actual windows only, missing quota text plus last-success time, correct image per state, and one animation element with the exact decrease for the matching row. Assert repeated render with no new decrease does not replay it.
- [ ] **Step 2: Run `npm test -- --run tests/renderer.test.ts`**; expect failure because the renderer does not exist.
- [ ] **Step 3: Copy the three supplied PNGs to `assets/` and implement the renderer** with CSS bottom alignment, transparency, a compact quota card, draggable pet region, local reset-time display, progress bars, and an upward fading `-X%` animation. Use Vite to bundle local assets; do not fetch remote media.
- [ ] **Step 4: Run `npm test -- --run tests/renderer.test.ts` and `npm run build:renderer`**; expect pass and built renderer assets. Preview A/B/C at the same display height and correct any clipping; the transparent Electron window is verified in Task 5.
- [ ] **Step 5: Commit** the Task 4 files with `feat: render quota desktop pet`.

### Task 5: Electron Lifecycle, Tray, Settings, and Package

**Files:** Create `src/main/appState.ts`, `src/main/windowState.ts`, `src/main/main.ts`, `src/main/preload.ts`, `tests/windowState.test.ts`, `tests/mainState.test.ts`, `electron-builder.yml`; update `package.json`.

**Interfaces:**
- `clampWindowBounds(saved: Electron.Rectangle | null, workAreas: Electron.Rectangle[], size: { width: number; height: number }): Electron.Rectangle` returns visible bounds, defaulting near the primary screen's lower-right corner.
- `window.petBridge` exposes only `onState`, `refreshQuota`, and `setAutostart`; main process pushes normalized, serializable view state from Tasks 1–3.
- `createAppStateController(deps: { quotaClient: ReturnType<typeof createCodexQuotaClient>; activityWatcher: ReturnType<typeof createActivityWatcher>; publish: (state: PetViewState) => void; clock: { setInterval(fn: () => void, ms: number): unknown; clearInterval(id: unknown): void } }): { start(): Promise<void>; refresh(): Promise<void>; stop(): Promise<void> }` lives in `src/main/appState.ts`, owns 60-second scheduling and state transitions, and uses an injected clock in tests.
- The app starts quota and activity services once, owns their timers, sends `QuotaWindow[]`, pet state, availability, and decrease events to the renderer, and shuts services down on explicit quit.

- [ ] **Step 1: Write failing tests** for an off-screen saved position, multiple displays, low-quota priority while working, startup quota failure, recovery without catch-up animation, 60-second refresh scheduling, and service cleanup on quit. Assert expected visible bounds and pushed view state.
- [ ] **Step 2: Run `npm test -- --run tests/windowState.test.ts tests/mainState.test.ts`**; expect failure because orchestration functions do not exist.
- [ ] **Step 3: Implement the Electron main and preload modules** with `contextIsolation: true`, `nodeIntegration: false`, a transparent frameless always-on-top window, persisted window position, right-click menu, tray hide/show, manual refresh, optional autostart defaulting off, and explicit quit. Configure `electron-builder` for a Windows installer; omit user credentials and absolute source-image paths from packaged output.
- [ ] **Step 4: Run `npm test -- --run`, `npm run build`, and `npm run dist:win`**; expect passing tests, compiled assets, and an installable artifact. Launch the app locally and verify real quota, a live Desktop task A→B transition, C at a simulated 20% boundary, `-X%`, tray recovery, visual transparency, and quit without leftover child process.
- [ ] **Step 5: Commit** the Task 5 files with `feat: ship Windows Codex quota pet`.

## Final Check

- [ ] Review every spec section against the shipped app and check for unhandled inputs from Review Focus.
- [ ] Run the full tests, production build, and Windows package once after all tasks are integrated; record the commands and exact outcomes.
- [ ] Inspect `git diff --check`, `git status -sb`, and the package contents for leaked paths, secrets, or omitted images.
- [ ] Obtain a fresh independent whole-branch review as required by the chosen execution approach; address actionable findings before reporting completion.
