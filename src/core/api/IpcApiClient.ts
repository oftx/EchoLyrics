import { ApiClient } from "./ApiClient";
import { Logger } from "../utils/Logger";

export class IpcApiClient implements ApiClient {
    async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
        if (!window.electronAPI) {
            throw new Error("Electron API not found");
        }
        try {
            const result = await window.electronAPI.request({ method: 'GET', url, headers });
            return result as T;
        } catch (error) {
            Logger.error(`[IpcApiClient] GET JSON failed: ${url}`, error);
            throw error;
        }
    }

    async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
        if (!window.electronAPI) {
            throw new Error("Electron API not found");
        }
        try {
            const result = await window.electronAPI.request({ method: 'GET', url, headers });
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
            Logger.error(`[IpcApiClient] GET Text failed: ${url}`, error);
            throw error;
        }
    }
}
