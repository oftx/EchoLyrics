export interface ElectronAPI {
    getAppVersion: () => Promise<string>;
    request: (config: { method: string; url: string; headers?: Record<string, string>; body?: any }) => Promise<any>;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}
