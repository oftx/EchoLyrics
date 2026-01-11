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

    public calculateScore(target: SongInformation, candidate: LyricResult): number {
        // 1. Calculate Primary Score
        let maxScore = this.calculateScoreInternal(target.title, target.artists, target, candidate);
        let debugBestMatch = "Primary";

        // 2. Check Aliases
        if (target.searchAliases) {
            // Check Title Aliases
            if (target.searchAliases.title) {
                for (const aliasTit of target.searchAliases.title) {
                    const score = this.calculateScoreInternal(aliasTit, target.artists, target, candidate);
                    if (score > maxScore) {
                        maxScore = score;
                        debugBestMatch = `AliasTitle(${aliasTit})`;
                    }
                }
            }

            // Check Artist Aliases (with primary title)
            if (target.searchAliases.artist) {
                for (const aliasArt of target.searchAliases.artist) {
                    const score = this.calculateScoreInternal(target.title, [aliasArt], target, candidate);
                    if (score > maxScore) {
                        maxScore = score;
                        debugBestMatch = `AliasArtist(${aliasArt})`;
                    }
                }
            }

            // Check Both (Combinations) - Iterate both arrays?
            // Heuristic: If we have both, try pairing them.
            if (target.searchAliases.title && target.searchAliases.artist) {
                for (const aliasTit of target.searchAliases.title) {
                    for (const aliasArt of target.searchAliases.artist) {
                        const score = this.calculateScoreInternal(aliasTit, [aliasArt], target, candidate);
                        if (score > maxScore) {
                            maxScore = score;
                            debugBestMatch = `AliasBoth(${aliasTit}, ${aliasArt})`;
                        }
                    }
                }
            }
        }

        Logger.debug(`[Scoring] Best Match: ${debugBestMatch} | Score: ${maxScore}`);
        return maxScore;
    }

    private calculateScoreInternal(targetTitle: string, targetArtists: string[], target: SongInformation, candidate: LyricResult): number {
        let score = 0;
        const debugInfo: string[] = [`Scoring '${candidate.title}' vs Target '${targetTitle}'`];

        // 1. Title Match (40%)
        let titleSim = 0;
        if (candidate.title) {
            titleSim = calculateSimilarity(targetTitle, candidate.title);
            let partScore = titleSim * ScoringService.WEIGHT_TITLE;

            // Boost for exact title match to prevent 0 score if other metadata fails
            if (titleSim >= 0.95) {
                // Determine if we need a bonus. If other scores are low, this ensures visibility.
                // We don't add extra points, but we ensure high base.
            }

            score += partScore;
            debugInfo.push(`Title: ${titleSim.toFixed(2)} * 40 = ${partScore.toFixed(1)}`);
        }

        // 2. Artist Match (30%)
        if (candidate.artist) {
            const artistSim = this.calculateArtistSimilarity(targetArtists, candidate.artist);
            const partScore = artistSim * ScoringService.WEIGHT_ARTIST;
            score += partScore;
            debugInfo.push(`Artist: ${artistSim.toFixed(2)} * 30 = ${partScore.toFixed(1)}`);
        }

        // 3. Album Match (20%)
        if (target.album && candidate.album) {
            const sim = calculateSimilarity(target.album, candidate.album);
            const partScore = sim * ScoringService.WEIGHT_ALBUM;
            score += partScore;
            debugInfo.push(`Album: ${sim.toFixed(2)} * 20 = ${partScore.toFixed(1)}`);
        }

        // 4. Duration Match (10%) - Graduated
        if (target.duration > 0 && candidate.duration && candidate.duration > 0) {
            const diff = Math.abs(target.duration - candidate.duration);
            const durationScore = this.calculateDurationScore(diff);
            score += durationScore;
            debugInfo.push(`Duration: ${durationScore > 0 ? '+' : ''}${durationScore} (diff ${diff}ms)`);
        }

        const finalScore = Math.round(score);
        // Logger.debug(`${debugInfo.join(' | ')} | Total: ${finalScore}`); // Verbose
        return finalScore;
    }

    private calculateArtistSimilarity(targetArtists: string[], candidateArtist: string): number {
        // 1. Normalize separators: Replace [&, /] with comma
        // Target is array, Candidate is string.

        // Helper to tokenize an artist string
        const tokenize = (str: string) => {
            return str.toLowerCase()
                .replace(/[\&\/]/g, ',') // Unify separators
                .split(/[, ]+/) // Split by comma or space
                .map(s => s.trim())
                .filter(s => s.length > 0);
        };

        const targetTokens = new Set(targetArtists.flatMap(a => tokenize(a)));
        const candidateTokens = new Set(tokenize(candidateArtist));

        // 2. Set Inclusion Check
        // If one set is a subset of the other (meaning robust match), give high score.
        let matchCount = 0;
        targetTokens.forEach(t => {
            if (candidateTokens.has(t)) matchCount++;
        });

        // Jaccard-ish: Interaction
        const intersection = matchCount;
        const union = new Set([...targetTokens, ...candidateTokens]).size;

        if (union === 0) return 0;

        // If all target artists are present in candidate (or vice versa), it's a very strong match
        // e.g. Target: ["Kano"], Candidate: "Kano, someone" -> match
        if (matchCount === targetTokens.size || matchCount === candidateTokens.size) {
            return 1.0;
        }

        // Otherwise use intersection/union
        const jaccard = intersection / union;

        // Fallback: If Jaccard is low (e.g. typos), use Levenshtein on the raw strings
        // But Jaccard is usually better for "Artist A, Artist B" vs "Artist A"
        if (jaccard > 0.5) return jaccard;

        // Levenshtein Fallback
        const targetJoined = targetArtists.join(" ");
        return Math.max(jaccard, calculateSimilarity(targetJoined, candidateArtist));
    }

    private calculateDurationScore(diffMs: number): number {
        if (diffMs <= 1000) return 10;   // Perfect
        if (diffMs <= 3000) return 7;    // Very Close
        if (diffMs <= 5000) return 4;    // Close
        if (diffMs <= 10000) return 0;   // Acceptable
        if (diffMs <= 20000) return -5;  // Discouraged
        return -10;                      // Bad
    }
}
