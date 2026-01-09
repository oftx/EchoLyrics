import { SongInformation } from "../interfaces/SongInformation";
import { LyricResult } from "../interfaces/LyricResult";
import { calculateSimilarity } from "../utils/Levenshtein";
import { Logger } from "../utils/Logger";

/**
 * Implements the scoring logic defined in Spec 2.3.1.3
 */
export class ScoringService {
    // Weights
    private static WEIGHT_TITLE = 40;
    private static WEIGHT_ARTIST = 30;
    private static WEIGHT_ALBUM = 20;
    private static WEIGHT_DURATION = 10;

    public calculateScore(target: SongInformation, candidate: LyricResult): number {
        let score = 0;
        const debugInfo: string[] = [`Scoring '${candidate.title}' vs Target '${target.title}'`];

        // 1. Title Match (40%)
        if (candidate.title) {
            const sim = calculateSimilarity(target.title, candidate.title);
            const partScore = sim * ScoringService.WEIGHT_TITLE;
            score += partScore;
            debugInfo.push(`Title: ${sim.toFixed(2)} * 40 = ${partScore.toFixed(1)}`);
        }

        // 2. Artist Match (30%)
        if (candidate.artist) {
            const targetArtist = target.artists.join(" ");
            const sim = calculateSimilarity(targetArtist, candidate.artist);
            const partScore = sim * ScoringService.WEIGHT_ARTIST;
            score += partScore;
            debugInfo.push(`Artist: ${sim.toFixed(2)} * 30 = ${partScore.toFixed(1)}`);
        }

        // 3. Album Match (20%)
        if (target.album && candidate.album) {
            const sim = calculateSimilarity(target.album, candidate.album);
            const partScore = sim * ScoringService.WEIGHT_ALBUM;
            score += partScore;
            debugInfo.push(`Album: ${sim.toFixed(2)} * 20 = ${partScore.toFixed(1)}`);
        }

        // 4. Duration Match (10%)
        if (target.duration > 0 && candidate.duration && candidate.duration > 0) {
            const diff = Math.abs(target.duration - candidate.duration);
            if (diff <= 2000) {
                score += ScoringService.WEIGHT_DURATION;
                debugInfo.push(`Duration: Match (+10)`);
            } else {
                score -= ScoringService.WEIGHT_DURATION;
                debugInfo.push(`Duration: Mismatch (-10, diff ${diff}ms)`);
            }
        }

        const finalScore = Math.round(score);
        Logger.debug(`${debugInfo.join(' | ')} | Total: ${finalScore}`);
        return finalScore;
    }
}
