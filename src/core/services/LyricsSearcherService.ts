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

    public async search(song: SongInformation, limit: number = 15, onResult?: (results: LyricResult[]) => void): Promise<LyricResult[]> {
        // Spec 2.3.1.2: Multi-source concurrent search.

        // 1. Resolve aliases centrally if strict matching failed before? 
        // Actually, to implement the plan "Update LyricsSearcherService to populate aliases", 
        // I need to instantiate SearchQueryResolver here.

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
                const results = await p.search(song, limit);
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
