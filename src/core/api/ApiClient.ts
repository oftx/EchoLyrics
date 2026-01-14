export interface ApiClient {
    getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
    getText(url: string, headers?: Record<string, string>): Promise<string>;
}
