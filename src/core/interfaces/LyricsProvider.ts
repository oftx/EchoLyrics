import { SongInformation } from "./SongInformation";
import { LyricResult } from "./LyricResult";

/**
 * Interface for a source of lyrics.
 */
export interface LyricsProvider {
    /**
     * Name of the provider.
     */
    name: string;

    /**
     * Search for lyrics.
     * @param song Song metadata.
     */
    search(song: SongInformation): Promise<LyricResult[]>;
}
