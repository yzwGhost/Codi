import { contextBridge, ipcRenderer } from 'electron';
import type { PetViewState } from '../shared/petState';

contextBridge.exposeInMainWorld('petBridge', {
  onState(callback: (state: PetViewState) => void) {
    const listener = (_event: Electron.IpcRendererEvent, state: PetViewState) => callback(state);
    ipcRenderer.on('pet-state', listener);
    return () => ipcRenderer.removeListener('pet-state', listener);
  },
  refreshQuota: () => ipcRenderer.invoke('refresh-quota'),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', enabled),
});
