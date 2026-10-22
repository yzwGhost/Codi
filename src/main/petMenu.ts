import { petScales, type PetScale } from './petSettings';

type MenuState = { visible: boolean; autostart: boolean; scale: PetScale };
type MenuActions = {
  toggleVisible(): void;
  refresh(): void;
  setAutostart(enabled: boolean): void;
  setScale(scale: PetScale): void;
  quit(): void;
};

export function createPetMenuItems(state: MenuState, actions: MenuActions): Electron.MenuItemConstructorOptions[] {
  return [
    { label: state.visible ? '隐藏桌宠' : '显示桌宠', click: actions.toggleVisible },
    { label: '刷新额度', click: actions.refresh },
    { label: '开机启动', type: 'checkbox', checked: state.autostart, click: item => actions.setAutostart(item.checked) },
    { label: '桌宠大小', submenu: petScales.map(scale => ({ label: `${Math.round(scale * 100)}%`, type: 'radio' as const, checked: scale === state.scale, click: () => actions.setScale(scale) })) },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ];
}
