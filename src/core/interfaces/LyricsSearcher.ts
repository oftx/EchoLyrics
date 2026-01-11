import { SongInformation } from "./SongInformation";
import { LyricResult } from "./LyricResult";

/**
 * Interface for finding lyrics from various sources.
 * Spec Reference: 2.3
 */
export interface LyricsSearcher {
    /**
     * Search for lyrics for the given song.
     * @param song Metadata of the song to search for.
     * @param limit Max number of results (optional).
     * @param onResult Callback for incremental results (optional).
     * @returns List of results sorted by likely relevance.
     */
    search(song: SongInformation, limit?: number, onResult?: (results: LyricResult[]) => void): Promise<LyricResult[]>;
}
