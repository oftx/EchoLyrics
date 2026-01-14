import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    getAppVersion: () => ipcRenderer.invoke('app:version'),
    // Network API Proxy
    request: (config: any) => ipcRenderer.invoke('net:request', config),
    // PiP Window Control
    pip: {
        open: () => ipcRenderer.invoke('pip:open'),
        close: () => ipcRenderer.invoke('pip:close'),
        syncState: (state: any) => ipcRenderer.invoke('pip:syncState', state),
        onStateUpdate: (callback: (state: any) => void) => {
            ipcRenderer.on('pip:stateUpdate', (_event, state) => callback(state));
        }
    }
});
