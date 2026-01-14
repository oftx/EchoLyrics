import { Logger } from "../utils/Logger";

export enum DisplayMode {
    Original = "Original",
    Translation = "Translation",
    Both = "Both"
}

export interface UserPreferences {
    showAlbumArt: boolean;
    searchLimit: number;
    lyricOffset: number;
    displayMode: DisplayMode;
    volume: number;
    useNativePlayer: boolean;
    lastPlayedSongName: string | null; // Filename as distinct ID

    lastPlaybackTime: number; // in seconds
    lastActiveFolderName: string | null; // Name of the folder where the song is located
}

const DEFAULT_PREFERENCES: UserPreferences = {
    showAlbumArt: true,
    searchLimit: 15,
    lyricOffset: 0,
    displayMode: DisplayMode.Both,
    volume: 1.0,
    useNativePlayer: false,
    lastPlayedSongName: null,
    lastPlaybackTime: 0,
    lastActiveFolderName: null
};

export class PreferencesService {
    private static readonly STORAGE_KEY = "echo_lyrics_preferences_v1";

    /**
     * Get all saved preferences, merged with defaults
     */
    public static getPreferences(): UserPreferences {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return { ...DEFAULT_PREFERENCES };

            const parsed = JSON.parse(raw);
            return { ...DEFAULT_PREFERENCES, ...parsed };
        } catch (e) {
            Logger.error("[PreferencesService] Failed to load preferences", e);
            return { ...DEFAULT_PREFERENCES };
        }
    }

    /**
     * Save partial preferences merging with existing ones
     */
    public static savePreferences(changes: Partial<UserPreferences>): void {
        try {
            const current = this.getPreferences();
            const updated = { ...current, ...changes };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
            Logger.error("[PreferencesService] Failed to save preferences", e);
        }
    }

    /**
     * Clear all preferences
     */
    public static clearPreferences(): void {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) {
            Logger.error("[PreferencesService] Failed to clear preferences", e);
        }
    }
}
