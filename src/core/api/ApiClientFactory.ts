import { ApiClient } from "./ApiClient";
import { HttpApiClient } from "./HttpApiClient";
import { IpcApiClient } from "./IpcApiClient";

export class ApiClientFactory {
    static create(): ApiClient {
        if (window.electronAPI) {
            return new IpcApiClient();
        }
        return new HttpApiClient();
    }
}
