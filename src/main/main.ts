import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActivityWatcher } from './activityWatcher';
import { createAppStateController } from './appState';
import { resolveCodexExecutable } from './codexExecutable';
import { createCodexQuotaClient } from './codexQuotaClient';
import { clampWindowBounds, type Rectangle } from './windowState';
import type { PetViewState } from '../shared/petState';

const size = { width: 520, height: 380 };
const appDir = join(fileURLToPath(new URL('.', import.meta.url)));
const statePath = () => join(app.getPath('userData'), 'window-position.json');
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let latestState: PetViewState | null = null;
let controller: ReturnType<typeof createAppStateController> | null = null;

async function savedPosition(): Promise<Rectangle | null> {
  try {
    const saved = JSON.parse(await readFile(statePath(), 'utf8')) as Rectangle;
    return typeof saved.x === 'number' && typeof saved.y === 'number' ? saved : null;
  } catch {
    return null;
  }
}

async function savePosition(): Promise<void> {
  if (!window || window.isDestroyed()) return;
  const { x, y } = window.getBounds();
  await writeFile(statePath(), JSON.stringify({ x, y, ...size }), 'utf8').catch(() => {});
}

function isDesktopRunning(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3_000 }, (error, stdout) => {
      resolve(!error && stdout.split(/\r?\n/).some(line => /^"ChatGPT\.exe",/i.test(line.trim())));
    });
  });
}

function menuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: window?.isVisible() ? '隐藏桌宠' : '显示桌宠', click: () => window?.isVisible() ? window.hide() : window?.show() },
    { label: '刷新额度', click: () => { void controller?.refresh(); } },
    { label: '开机启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ];
}

async function createWindow(): Promise<void> {
  const bounds = clampWindowBounds(await savedPosition(), screen.getAllDisplays().map(display => display.workArea), size);
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
  window.on('move', () => { void savePosition(); });
  window.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.webContents.on('context-menu', () => Menu.buildFromTemplate(menuItems()).popup({ window: window! }));
  window.webContents.on('did-finish-load', () => { if (latestState) window?.webContents.send('pet-state', latestState); });
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
  const executable = await resolveCodexExecutable().catch(() => null);
  const quotaClient = executable
    ? createCodexQuotaClient({ executable, onSnapshot: (raw, reconnect) => onSnapshot(raw, reconnect), onUnavailable: () => onUnavailable() })
    : { start: async () => { throw new Error('Codex executable unavailable'); }, refresh: async () => { throw new Error('Codex executable unavailable'); }, stop: async () => {} };
  const activityWatcher = createActivityWatcher({ codexHome: home, onChange: value => onActivity(value), isDesktopRunning });
  controller = createAppStateController({
    quotaClient, activityWatcher,
    publish: state => {
      latestState = state;
      if (window && !window.isDestroyed()) window.webContents.send('pet-state', state);
    },
  });
  onSnapshot = controller.onSnapshot;
  onUnavailable = controller.onUnavailable;
  onActivity = controller.onActivity;
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
    void controller?.stop();
  });
  app.on('window-all-closed', () => {});
}
