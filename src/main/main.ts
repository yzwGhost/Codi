import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActivityWatcher } from './activityWatcher';
import { createAppStateController } from './appState';
import { resolveCodexExecutable } from './codexExecutable';
import { createCodexQuotaClient } from './codexQuotaClient';
import { createPetMenuItems } from './petMenu';
import { attachPetContextMenu } from './petInteractions';
import { parsePetSettings, type PetScale } from './petSettings';
import { attachEdgeSnapping } from './windowSnapping';
import { clampWindowBounds, petWindowSize, windowBoundsForQuota } from './windowState';
import type { PetViewState } from '../shared/petState';

const appDir = join(fileURLToPath(new URL('.', import.meta.url)));
const statePath = () => join(app.getPath('userData'), 'window-position.json');
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let latestState: PetViewState | null = null;
let controller: ReturnType<typeof createAppStateController> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let petScale: PetScale = 1;

async function savedSettings(): Promise<ReturnType<typeof parsePetSettings>> {
  try {
    return parsePetSettings(JSON.parse(await readFile(statePath(), 'utf8')));
  } catch {
    return parsePetSettings(null);
  }
}

function savePosition(): void {
  if (!window || window.isDestroyed()) return;
  try { writeFileSync(statePath(), JSON.stringify({ ...window.getBounds(), scale: petScale }), 'utf8'); } catch { /* Restore defaults on the next launch. */ }
}

function scheduleSavePosition(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; savePosition(); }, 150);
}

function reclampWindow(): void {
  if (!window || window.isDestroyed()) return;
  const current = window.getBounds();
  const next = clampWindowBounds(current, screen.getAllDisplays().map(display => display.workArea), current);
  if (next.x !== current.x || next.y !== current.y) window.setBounds(next);
}

function resizeForQuota(rowCount: number): void {
  if (!window || window.isDestroyed()) return;
  const current = window.getBounds();
  const next = windowBoundsForQuota(current, screen.getAllDisplays().map(display => display.workArea), rowCount, petScale);
  if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) window.setBounds(next);
}

function sendState(): void {
  if (window && !window.isDestroyed() && latestState) window.webContents.send('pet-state', { ...latestState, sizeScale: petScale });
}

function setPetScale(scale: PetScale): void {
  petScale = scale;
  resizeForQuota(latestState?.quotaUnavailable ? 0 : latestState?.windows?.length ?? 0);
  sendState();
  scheduleSavePosition();
}

function isDesktopRunning(): Promise<boolean | null> {
  return new Promise(resolve => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3_000 }, (error, stdout) => {
      resolve(error ? null : stdout.split(/\r?\n/).some(line => /^"ChatGPT\.exe",/i.test(line.trim())));
    });
  });
}

function menuItems(): Electron.MenuItemConstructorOptions[] {
  return createPetMenuItems(
    { visible: window?.isVisible() ?? false, autostart: app.getLoginItemSettings().openAtLogin, scale: petScale },
    {
      toggleVisible: () => window?.isVisible() ? window.hide() : window?.show(),
      refresh: () => { void controller?.refresh(); },
      setAutostart: enabled => app.setLoginItemSettings({ openAtLogin: enabled }),
      setScale: setPetScale,
      quit: () => { quitting = true; app.quit(); },
    },
  );
}

async function createWindow(): Promise<void> {
  const saved = await savedSettings();
  petScale = saved.scale;
  const bounds = clampWindowBounds(saved.position, screen.getAllDisplays().map(display => display.workArea), petWindowSize(0, petScale));
  window = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(appDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setAlwaysOnTop(true, 'floating');
  window.on('move', scheduleSavePosition);
  attachEdgeSnapping(window, bounds => screen.getDisplayMatching(bounds).workArea);
  window.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      window?.hide();
    }
  });
  attachPetContextMenu(window, () => Menu.buildFromTemplate(menuItems()).popup({ window: window! }));
  window.webContents.on('did-finish-load', sendState);
  screen.on('display-removed', reclampWindow);
  screen.on('display-metrics-changed', reclampWindow);
  screen.on('display-added', reclampWindow);
  await window.loadFile(join(appDir, '..', 'renderer', 'index.html'));
}

function createTray(): void {
  const iconPath = join(appDir, '..', '..', 'assets', 'pet-idle.png');
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
  tray.setToolTip('Codex 额度桌宠');
  tray.on('click', () => window?.isVisible() ? window.hide() : window?.show());
  tray.on('right-click', () => tray?.popUpContextMenu(Menu.buildFromTemplate(menuItems())));
}

async function startServices(): Promise<void> {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex');
  let onSnapshot: (raw: unknown, reconnect: boolean) => void = () => {};
  let onUnavailable: () => void = () => {};
  let onActivity: (working: boolean) => void = () => {};
  let onActivityAvailability: (available: boolean) => void = () => {};
  const executable = await resolveCodexExecutable().catch(() => null);
  const quotaClient = executable
    ? createCodexQuotaClient({ executable, onSnapshot: (raw, reconnect) => onSnapshot(raw, reconnect), onUnavailable: () => onUnavailable() })
    : { start: async () => { throw new Error('Codex executable unavailable'); }, refresh: async () => { throw new Error('Codex executable unavailable'); }, stop: async () => {} };
  const activityWatcher = createActivityWatcher({ codexHome: home, onChange: value => onActivity(value), onAvailabilityChange: value => onActivityAvailability(value), isDesktopRunning });
  controller = createAppStateController({
    quotaClient, activityWatcher,
    publish: state => {
      latestState = state;
      resizeForQuota(state.quotaUnavailable ? 0 : state.windows?.length ?? 0);
      sendState();
    },
  });
  onSnapshot = controller.onSnapshot;
  onUnavailable = controller.onUnavailable;
  onActivity = controller.onActivity;
  onActivityAvailability = controller.onActivityAvailability;
  await controller.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    ipcMain.handle('refresh-quota', () => controller?.refresh());
    ipcMain.handle('set-autostart', (_event, enabled: boolean) => app.setLoginItemSettings({ openAtLogin: Boolean(enabled) }));
    await createWindow();
    createTray();
    await startServices();
  }).catch(() => {});
  app.on('before-quit', () => {
    quitting = true;
    if (saveTimer) clearTimeout(saveTimer);
    savePosition();
    void controller?.stop();
  });
  app.on('window-all-closed', () => {});
}
