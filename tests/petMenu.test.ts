import { expect, it, vi } from 'vitest';
import { createPetMenuItems } from '../src/main/petMenu';

it('offers four sizes and selects the current one', () => {
  const setScale = vi.fn();
  const items = createPetMenuItems({ visible: true, autostart: false, scale: 1.25 }, {
    toggleVisible: vi.fn(), refresh: vi.fn(), setAutostart: vi.fn(), setScale, quit: vi.fn(),
  });
  const size = items.find(item => item.label === '桌宠大小');
  expect(Array.isArray(size?.submenu)).toBe(true);
  const choices = size!.submenu as Electron.MenuItemConstructorOptions[];
  expect(choices.map(choice => choice.label)).toEqual(['75%', '100%', '125%', '150%']);
  expect(choices.map(choice => choice.checked)).toEqual([false, false, true, false]);
  choices[3].click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
  expect(setScale).toHaveBeenCalledWith(1.5);
});

it('keeps refresh and startup controls in the same menu', () => {
  const refresh = vi.fn();
  const setAutostart = vi.fn();
  const items = createPetMenuItems({ visible: false, autostart: true, scale: 1 }, {
    toggleVisible: vi.fn(), refresh, setAutostart, setScale: vi.fn(), quit: vi.fn(),
  });
  expect(items[0].label).toBe('显示桌宠');
  items.find(item => item.label === '刷新额度')!.click?.({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
  expect(refresh).toHaveBeenCalledOnce();
  const startup = items.find(item => item.label === '开机启动')!;
  expect(startup.checked).toBe(true);
  startup.click?.({ checked: false } as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
  expect(setAutostart).toHaveBeenCalledWith(false);
});
