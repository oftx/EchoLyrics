import { Logger } from '../utils/Logger';

// TypeScript type extensions for File System Access API
// These may not be in the standard DOM types yet
export interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string | WriteParams): Promise<void>;
    seek(position: number): Promise<void>;
    truncate(size: number): Promise<void>;
}

interface WriteParams {
    type: 'write' | 'seek' | 'truncate';
    data?: BufferSource | Blob | string;
    position?: number;
    size?: number;
}

export interface PlaylistItem {
    name: string;
    audioFile: File;
    lyricFile?: File;
    title?: string;
    artist?: string;
    isrc?: string;
}

/**
 * Service for persisting folder access using File System Access API
 * Stores directory handles in IndexedDB for persistent access
 */
export class FolderPersistenceService {
    private static readonly DB_NAME = 'echo-lyrics-db';
    private static readonly DB_VERSION = 1;
    private static readonly STORE_NAME = 'folder-handles';
    private static readonly STORAGE_KEY = 'saved-folders';
    private static readonly LEGACY_KEY = 'music-folder';

    /**
     * Check if File System Access API is supported
     */
    public static isSupported(): boolean {
        return 'showDirectoryPicker' in window;
    }

    /**
     * Open IndexedDB connection
     */
    private static async openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                Logger.error('[FolderPersistence] Failed to open IndexedDB', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                    Logger.info('[FolderPersistence] Created IndexedDB object store');
                }
            };
        });
    }



    /**
     * Add a directory handle to IndexedDB
     */
    public static async addFolderHandle(newHandle: FileSystemDirectoryHandle): Promise<void> {
        try {
            // 1. Validation Phase: Get existing handles first
            // We use getSavedFolderHandles which handles its own read transaction
            const handles = await this.getSavedFolderHandles();

            // 2. Duplicate Check Phase (Async)
            // This loop awaits promises, so it MUST be done outside of the write transaction
            // otherwise the transaction will auto-commit/fail due to inactivity.
            for (const h of handles) {
                if (await h.isSameEntry(newHandle)) {
                    Logger.info(`[FolderPersistence] Folder already saved: ${newHandle.name}`);
                    return;
                }
            }

            // 3. Write Phase: Open a NEW transaction just for writing
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            handles.push(newHandle);
            store.put(handles, this.STORAGE_KEY);

            // Cleanup legacy key just in case
            store.delete(this.LEGACY_KEY);

            Logger.info(`[FolderPersistence] Added folder: ${newHandle.name}`);

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });

        } catch (error) {
            Logger.error('[FolderPersistence] Failed to add folder handle', error);
            throw error;
        }
    }

    /**
     * Get all saved folder handles
     * Handles migration transparently
     */
    public static async getSavedFolderHandles(): Promise<FileSystemDirectoryHandle[]> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            return new Promise<FileSystemDirectoryHandle[]>((resolve, reject) => {
                const request = store.get(this.STORAGE_KEY);
                request.onsuccess = () => {
                    const list = request.result as FileSystemDirectoryHandle[];
                    if (list && Array.isArray(list)) {
                        resolve(list);
                    } else {
                        // Fallback: Check legacy
                        const legacyReq = store.get(this.LEGACY_KEY);
                        legacyReq.onsuccess = () => {
                            const legacyHandle = legacyReq.result;
                            if (legacyHandle) {
                                Logger.info('[FolderPersistence] Found legacy handle, migrating...');
                                const newList = [legacyHandle];
                                store.put(newList, this.STORAGE_KEY);
                                store.delete(this.LEGACY_KEY);
                                resolve(newList);
                            } else {
                                resolve([]);
                            }
                        };
                        legacyReq.onerror = () => resolve([]);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to get saved folders', error);
            return [];
        }
    }

    /**
     * Remove a specific folder handle
     */
    public static async removeFolderHandle(handleToRemove: FileSystemDirectoryHandle): Promise<void> {
        try {
            const handles = await this.getSavedFolderHandles();
            const newHandles: FileSystemDirectoryHandle[] = [];

            for (const h of handles) {
                if (!(await h.isSameEntry(handleToRemove))) {
                    newHandles.push(h);
                }
            }

            if (newHandles.length !== handles.length) {
                const db = await this.openDB();
                const transaction = db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                store.put(newHandles, this.STORAGE_KEY);
                Logger.info('[FolderPersistence] Removed folder handle');
            }
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to remove folder', error);
        }
    }

    /**
     * Clear all saved folders
     */
    public static async clearAllSavedFolders(): Promise<void> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            store.delete(this.STORAGE_KEY);
            store.delete(this.LEGACY_KEY);
            Logger.info('[FolderPersistence] Cleared all saved folders');
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to clear all folders', error);
        }
    }

    /**
     * Check permissions for a handle
     */
    public static async verifyPermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
        try {
            const permission = await dirHandle.queryPermission({ mode: 'read' });
            if (permission === 'granted') return true;
            if (permission === 'prompt') {
                const newPermission = await dirHandle.requestPermission({ mode: 'read' });
                return newPermission === 'granted';
            }
            return false;
        } catch (error) {
            console.warn('[FolderPersistence] Permission check failed', error);
            return false;
        }
    }

    /**
     * Select a folder and add it to storage
     */
    public static async selectFolder(): Promise<FileSystemDirectoryHandle | null> {
        if (!this.isSupported()) return null;

        try {
            // @ts-expect-error - Types
            const dirHandle = await window.showDirectoryPicker({
                mode: 'read',
                startIn: 'music'
            }) as FileSystemDirectoryHandle;

            await this.addFolderHandle(dirHandle);
            return dirHandle;
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                Logger.error('[FolderPersistence] Failed to select folder', error);
            }
            return null;
        }
    }

    /**
     * Read files (Recursive) - Kept same logic
     */
    public static async readFilesFromFolder(dirHandle: FileSystemDirectoryHandle): Promise<PlaylistItem[]> {
        const audioExtensions = /\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i;
        const lyricExtensions = /\.(lrc|txt|json|qrc)$/i;

        const audioFiles = new Map<string, File>();
        const lyricFiles = new Map<string, File>();

        const traverseDirectory = async (handle: FileSystemDirectoryHandle) => {
            try {
                for await (const entry of handle.values()) {
                    if (entry.kind === 'file') {
                        const file = await (entry as FileSystemFileHandle).getFile();
                        const fileName = file.name;
                        const baseName = fileName.replace(/\.[^/.]+$/, '');

                        if (audioExtensions.test(fileName)) {
                            audioFiles.set(baseName, file);
                        } else if (lyricExtensions.test(fileName)) {
                            lyricFiles.set(baseName, file);
                        }
                    } else if (entry.kind === 'directory') {
                        await traverseDirectory(entry as FileSystemDirectoryHandle);
                    }
                }
            } catch (error) {
                Logger.warn(`[FolderPersistence] Error reading directory ${handle.name}`, error);
            }
        };

        try {
            await traverseDirectory(dirHandle);

            const playlist: PlaylistItem[] = [];
            for (const [baseName, audioFile] of audioFiles) {
                const lyricFile = lyricFiles.get(baseName);
                playlist.push({
                    name: audioFile.name,
                    audioFile,
                    lyricFile
                });
            }
            playlist.sort((a, b) => a.name.localeCompare(b.name));
            return playlist;
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to read files', error);
            return [];
        }
    }

    /**
     * Restore logic for single-folder auto-load 
     * (We can just return the first one for backwards compatibility / auto-start)
     */
    public static async restoreSavedFolder(preferredName?: string | null): Promise<FileSystemDirectoryHandle | null> {
        const handles = await this.getSavedFolderHandles();
        if (handles.length > 0) {
            let handle = handles[0];

            // Try to find the preferred one
            if (preferredName) {
                const found = handles.find(h => h.name === preferredName);
                if (found) handle = found;
            }

            if (await this.verifyPermission(handle)) {
                return handle;
            }
        }
        return null;
    }
}
