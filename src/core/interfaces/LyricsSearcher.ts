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
     * @returns List of results sorted by likely relevance.
     */
    search(song: SongInformation): Promise<LyricResult[]>;
}
