import { ApiClient } from "./ApiClient";
import { Logger } from "../utils/Logger";

export class HttpApiClient implements ApiClient {
    async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
        try {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            Logger.error(`[HttpApiClient] GET JSON failed: ${url}`, error);
            throw error;
        }
    }

    async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
        try {
            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            Logger.error(`[HttpApiClient] GET Text failed: ${url}`, error);
            throw error;
        }
    }
}
