import { LyricsSearcher } from "../interfaces/LyricsSearcher";
import { SongInformation } from "../interfaces/SongInformation";
import { LyricResult } from "../interfaces/LyricResult";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { ScoringService } from "./ScoringService";

/**
 * Orchestrates the search across multiple providers.
 */
export class LyricsSearcherService implements LyricsSearcher {
    private providers: LyricsProvider[] = [];
    private scoringService = new ScoringService();

    public registerProvider(provider: LyricsProvider) {
        this.providers.push(provider);
    }

    public async search(song: SongInformation, limit: number = 15): Promise<LyricResult[]> {
        // Spec 2.3.1.2: Multi-source concurrent search.
        const searchTasks = this.providers.map(p =>
            p.search(song, limit).catch(err => {
                console.error(`Provider ${p.name} failed:`, err);
                return [] as LyricResult[];
            })
        );

        const resultsOfResults = await Promise.all(searchTasks);
        let allResults = resultsOfResults.flat();

        // Calculate scores
        allResults.forEach(res => {
            res.score = this.scoringService.calculateScore(song, res);
        });

        // Filter valid candidates (Threshold e.g. 60 from Spec 2.3.1.4)
        // REMOVED THRESHOLD: Allow all results to pass through for "best guess" logic.
        // allResults = allResults.filter(r => r.score >= 40);

        // Sort by score descending
        allResults.sort((a, b) => b.score - a.score);

        return allResults;
    }
}
