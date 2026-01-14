"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getAppVersion: () => electron_1.ipcRenderer.invoke('app:version'),
    // Network API Proxy
    request: (config) => electron_1.ipcRenderer.invoke('net:request', config),
    // PiP Window Control
    pip: {
        open: () => electron_1.ipcRenderer.invoke('pip:open'),
        close: () => electron_1.ipcRenderer.invoke('pip:close'),
        syncState: (state) => electron_1.ipcRenderer.invoke('pip:syncState', state),
        onStateUpdate: (callback) => {
            electron_1.ipcRenderer.on('pip:stateUpdate', (_event, state) => callback(state));
        }
    }
});
