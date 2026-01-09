import { Logger } from "../utils/Logger";
import { LyricsSearcherService } from "./LyricsSearcherService";
import { PlaybackSynchronizer } from "./PlaybackSynchronizer";
import { LyricsParser } from "../interfaces/LyricsParser";
import { StandardLrcParser } from "../parsers/StandardLrcParser";
import { EnhancedLrcParser } from "../parsers/EnhancedLrcParser";
import { LyricsData } from "../models/LyricsData";
import { SongInformation } from "../interfaces/SongInformation";


/**
 * Main facade for the UI to interact with.
 * Manages search, parsing, and state.
 */
export class LyricsManager {
    private searcher = new LyricsSearcherService();
    private synchronizer = new PlaybackSynchronizer();
    private parsers: LyricsParser[] = [
        new EnhancedLrcParser(), // Try enhanced first
        new StandardLrcParser()
    ];

    private currentLyrics: LyricsData | null = null;

    constructor() {
        // Init default parsers? yes.
    }

    public getSearcher(): LyricsSearcherService {
        return this.searcher;
    }

    public getSynchronizer(): PlaybackSynchronizer {
        return this.synchronizer;
    }

    /**
     * Parses the given text using available parsers.
     * @param text Raw lyrics text.
     */
    public parse(text: string): LyricsData {
        // Try all parsers. In reality, we might check format first.
        // EnhancedParser falls back to Standard if no tags found (implemented in EnhancedLrcParser),
        // so we can just use EnhancedParser as primary.
        const parser = this.parsers[0];
        const data = parser.parse(text);
        this.currentLyrics = data;
        return data;
    }

    public getCurrentLyrics(): LyricsData | null {
        return this.currentLyrics;
    }

    /**
     * High level method to load lyrics for a song.
     */
    public async loadLyricsForSong(song: SongInformation): Promise<boolean> {
        const results = await this.searcher.search(song);

        Logger.info(`[LyricsManager] Search returned ${results.length} candidates.`);
        results.forEach((r, i) => {
            Logger.debug(`[Candidate #${i}] Score: ${r.score} | Title: ${r.title} | Artist: ${r.artist}`);
        });

        if (results.length > 0) {
            // Pick best
            const best = results[0];
            Logger.info(`[LyricsManager] Selected: ${best.title} (Score: ${best.score})`);

            const data = this.parse(best.lyricText);
            if (!data.metadata) {
                data.metadata = {};
            }
            data.metadata['source'] = best.source;
            this.currentLyrics = data;
            return true;
        }
        return false;
    }
}
