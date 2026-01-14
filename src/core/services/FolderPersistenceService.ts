import { Logger } from '../utils/Logger';

// TypeScript type extensions for File System Access API
// These may not be in the standard DOM types yet
interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: 'directory';
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
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
    private static readonly FOLDER_KEY = 'music-folder';

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
     * Save directory handle to IndexedDB
     */
    public static async saveFolderHandle(dirHandle: FileSystemDirectoryHandle): Promise<void> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = store.put(dirHandle, this.FOLDER_KEY);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            db.close();
            Logger.info('[FolderPersistence] Saved folder handle to IndexedDB');
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to save folder handle', error);
            throw error;
        }
    }

    /**
     * Retrieve saved directory handle from IndexedDB
     */
    public static async getSavedFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);

            const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
                const request = store.get(this.FOLDER_KEY);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });

            db.close();

            if (handle) {
                Logger.info('[FolderPersistence] Retrieved folder handle from IndexedDB');
            } else {
                Logger.info('[FolderPersistence] No saved folder handle found');
            }

            return handle;
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to retrieve folder handle', error);
            return null;
        }
    }

    /**
     * Clear saved folder handle
     */
    public static async clearSavedFolder(): Promise<void> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            await new Promise<void>((resolve, reject) => {
                const request = store.delete(this.FOLDER_KEY);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            db.close();
            Logger.info('[FolderPersistence] Cleared saved folder handle');
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to clear folder handle', error);
        }
    }

    /**
     * Check and request permission for a directory handle
     * Returns true if permission is granted
     */
    public static async verifyPermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
        try {
            // Check current permission state
            const permission = await dirHandle.queryPermission({ mode: 'read' });

            if (permission === 'granted') {
                Logger.info('[FolderPersistence] Permission already granted');
                return true;
            }

            // If permission is 'prompt', request it
            if (permission === 'prompt') {
                const newPermission = await dirHandle.requestPermission({ mode: 'read' });
                if (newPermission === 'granted') {
                    Logger.info('[FolderPersistence] Permission granted by user');
                    return true;
                } else {
                    Logger.warn('[FolderPersistence] Permission denied by user');
                    return false;
                }
            }

            // Permission denied
            Logger.warn('[FolderPersistence] Permission denied');
            return false;
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to verify permission', error);
            return false;
        }
    }

    /**
     * Request user to select a folder using File System Access API
     * Automatically saves the handle if selected
     */
    public static async selectFolder(): Promise<FileSystemDirectoryHandle | null> {
        if (!this.isSupported()) {
            Logger.warn('[FolderPersistence] File System Access API not supported');
            return null;
        }

        try {
            // @ts-expect-error - TypeScript may not have the latest DOM types
            const dirHandle = await window.showDirectoryPicker({
                mode: 'read',
                startIn: 'music'
            }) as FileSystemDirectoryHandle;

            // Save the handle for future use
            await this.saveFolderHandle(dirHandle);

            Logger.info(`[FolderPersistence] Selected folder: ${dirHandle.name}`);
            return dirHandle;
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                Logger.info('[FolderPersistence] User cancelled folder selection');
            } else {
                Logger.error('[FolderPersistence] Failed to select folder', error);
            }
            return null;
        }
    }

    /**
     * Restore previously saved folder with permission check
     * Returns null if no saved folder or permission denied
     */
    public static async restoreSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
        if (!this.isSupported()) {
            return null;
        }

        const dirHandle = await this.getSavedFolderHandle();
        if (!dirHandle) {
            return null;
        }

        // Verify we still have permission
        const hasPermission = await this.verifyPermission(dirHandle);
        if (!hasPermission) {
            Logger.warn('[FolderPersistence] Permission lost for saved folder, clearing it');
            await this.clearSavedFolder();
            return null;
        }

        return dirHandle;
    }

    /**
     * Read all audio and lyric files from a directory handle
     */
    /**
     * Read all audio and lyric files from a directory handle (recursively)
     */
    public static async readFilesFromFolder(dirHandle: FileSystemDirectoryHandle): Promise<PlaylistItem[]> {
        const audioExtensions = /\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i;
        const lyricExtensions = /\.(lrc|txt|json|qrc)$/i; // Added json/qrc to match App.tsx

        const audioFiles = new Map<string, File>();
        const lyricFiles = new Map<string, File>();

        // Recursive function to traverse directories
        const traverseDirectory = async (handle: FileSystemDirectoryHandle) => {
            try {
                for await (const entry of handle.values()) {
                    if (entry.kind === 'file') {
                        const file = await (entry as FileSystemFileHandle).getFile();
                        const fileName = file.name;
                        // Use full relative path or just filename? 
                        // App.tsx uses simple matching which might have collisions if files have same name in different folders.
                        // But sticking to simple name matching for now to ensure consistency with current playlist map logic.
                        // However, strictly speaking, correct playlist logic should probably handle full paths.
                        // Given current App.tsx logic:
                        // "const baseName = name.substring(0, extIndex);" uses filename only.
                        // So we will stick to filename for now.

                        const baseName = fileName.replace(/\.[^/.]+$/, '');

                        if (audioExtensions.test(fileName)) {
                            // If we have duplicates, last one wins (or first? Map overrides).
                            audioFiles.set(baseName, file);
                        } else if (lyricExtensions.test(fileName)) {
                            lyricFiles.set(baseName, file);
                        }
                    } else if (entry.kind === 'directory') {
                        // Recursively traverse subdirectory
                        await traverseDirectory(entry as FileSystemDirectoryHandle);
                    }
                }
            } catch (error) {
                Logger.warn(`[FolderPersistence] Error reading directory ${handle.name}`, error);
            }
        };

        try {
            await traverseDirectory(dirHandle);

            // Match audio files with their corresponding lyric files
            const playlist: PlaylistItem[] = [];

            for (const [baseName, audioFile] of audioFiles) {
                const lyricFile = lyricFiles.get(baseName);
                playlist.push({
                    name: audioFile.name,
                    audioFile,
                    lyricFile
                });
            }

            // Sort playlist by name to have deterministic order
            playlist.sort((a, b) => a.name.localeCompare(b.name));

            Logger.info(`[FolderPersistence] Found ${playlist.length} audio files (${lyricFiles.size} with lyrics)`);
            return playlist;
        } catch (error) {
            Logger.error('[FolderPersistence] Failed to read files from folder', error);
            return [];
        }
    }

    /**
     * Complete workflow: try to restore saved folder, or prompt user to select one
     * Returns playlist items or null if user cancelled
     */
    public static async getFolder(): Promise<PlaylistItem[] | null> {
        // Try to restore saved folder first
        let dirHandle = await this.restoreSavedFolder();

        // If no saved folder or permission denied, ask user to select
        if (!dirHandle) {
            dirHandle = await this.selectFolder();
        }

        // User cancelled or API not supported
        if (!dirHandle) {
            return null;
        }

        // Read files from the folder
        return await this.readFilesFromFolder(dirHandle);
    }
}
