import { LyricsSearcher } from "../interfaces/LyricsSearcher";
import { SongInformation } from "../interfaces/SongInformation";
import { LyricResult } from "../interfaces/LyricResult";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { ScoringService } from "./ScoringService";
import { SearchQueryResolver } from "../utils/SearchQueryResolver";

/**
 * Orchestrates the search across multiple providers.
 */
export class LyricsSearcherService implements LyricsSearcher {
    private providers: LyricsProvider[] = [];
    private scoringService = new ScoringService();

    public registerProvider(provider: LyricsProvider) {
        this.providers.push(provider);
    }

    public getProviders(): LyricsProvider[] {
        return this.providers;
    }

    public async search(song: SongInformation, limit: number = 15, onResult?: (results: LyricResult[]) => void, onProgress?: (msg: string) => void): Promise<LyricResult[]> {
        // Spec 2.3.1.2: Multi-source concurrent search.

        if (onProgress) onProgress("Resolving search queries...");

        const resolver = new SearchQueryResolver();
        const queries = await resolver.resolveQueries(song);

        // Populate aliases
        if (!song.searchAliases) {
            song.searchAliases = { title: [], artist: [] };
        }
        queries.forEach(q => {
            song.searchAliases!.title!.push(q.title);
            song.searchAliases!.artist!.push(q.artist);
        });

        const searchTasks = this.providers.map(async (p) => {
            try {
                if (onProgress) onProgress(`Searching ${p.name}...`);

                // Wrap onProgress to bubble up messages
                const wrappedProgress = onProgress ? (msg: string) => {
                    // Decide if we should prefix? 
                    // Providers might already format nicely.
                    // But to be safe and consistent:
                    // If msg already starts with provider name, pass as is.
                    // Otherwise prefix.
                    if (msg.startsWith(`[${p.name}]`)) {
                        onProgress(msg);
                    } else {
                        onProgress(`[${p.name}] ${msg}`);
                    }
                } : undefined;

                const results = await p.search(song, limit, wrappedProgress);

                if (onProgress) onProgress(`${p.name} found ${results.length} result(s)`);

                // Score immediately
                results.forEach(res => {
                    res.score = this.scoringService.calculateScore(song, res);
                });

                // Sort this partial batch (optional, but good for "best so far")
                results.sort((a, b) => b.score - a.score);

                // Notify callback if provided
                if (onResult && results.length > 0) {
                    onResult(results);
                }

                return results;
            } catch (err) {
                console.error(`Provider ${p.name} failed:`, err);
                if (onProgress) onProgress(`${p.name} failed.`);
                return [] as LyricResult[];
            }
        });

        const resultsOfResults = await Promise.all(searchTasks);
        let allResults = resultsOfResults.flat();

        // Final Sort by score descending (to be sure)
        allResults.sort((a, b) => b.score - a.score);

        return allResults;
    }
}
