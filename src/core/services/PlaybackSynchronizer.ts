import { LyricsData, LyricsLine } from "../models/LyricsData";

/**
 * Handles time-based synchronization.
 * Spec 2.4: Must use Binary Search.
 */
export class PlaybackSynchronizer {
    /**
     * Finds the active lyric line for the given time.
     * @param lyrics Complete lyrics data.
     * @param currentTimeMs Current playback time.
     * @returns The active line index.
     */
    public findLineIndex(lyrics: LyricsData, currentTimeMs: number): number {
        const lines = lyrics.lines;
        if (!lines || lines.length === 0) return -1;

        // Binary search to find the line that starts <= currentTime
        let low = 0;
        let high = lines.length - 1;
        let result = -1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (lines[mid].startTime <= currentTimeMs) {
                result = mid; // Candidate found
                low = mid + 1; // Try to find a later one that is still <= current
            } else {
                high = mid - 1;
            }
        }

        return result;
    }

    /**
     * Calculates the progress (0.0 - 1.0) within the current line.
     * Used for syllable-level animations.
     * @param line The active line.
     * @param nextLine The next line (to determine duration), or null.
     * @param currentTimeMs Current playback time.
     */
    public calculateLineProgress(line: LyricsLine, nextLine: LyricsLine | undefined, currentTimeMs: number): number {
        const startTime = line.startTime;
        let endTime = 0;

        if (nextLine) {
            endTime = nextLine.startTime;
        } else {
            // Estimate duration if it's the last line using syllables or fixed time.
            if (line.syllables && line.syllables.length > 0) {
                const lastSyl = line.syllables[line.syllables.length - 1];
                endTime = startTime + lastSyl.startTime + lastSyl.duration;
            } else {
                endTime = startTime + 5000; // Fallback 5s
            }
        }

        const duration = endTime - startTime;
        if (duration <= 0) return 1;

        const elapsed = currentTimeMs - startTime;
        return Math.min(1, Math.max(0, elapsed / duration));
    }
}
