import { LyricsParser } from "../interfaces/LyricsParser";
import { LyricsData, Syllable } from "../models/LyricsData";
import { StandardLrcParser } from "./StandardLrcParser";

/**
 * Parses Enhanced LRC format with word-level timestamps `<mm:ss.xx>`.
 * Spec Reference: 2.2.1 Sample 2
 */
export class EnhancedLrcParser implements LyricsParser {
    // Regex to match <mm:ss.xx>
    private static SYLLABLE_REGEX = /<(\d{2}):(\d{2}(?:\.\d{2,3})?)>/g;

    private standardParser = new StandardLrcParser();

    public parse(rawText: string): LyricsData {
        // Reuse standard parser for line-level timing and metadata
        const basicData = this.standardParser.parse(rawText);

        basicData.lines.forEach(line => {
            // Check if text contains <timestamp>
            if (EnhancedLrcParser.SYLLABLE_REGEX.test(line.text)) {
                line.syllables = this.parseSyllables(line.text, line.startTime);
                // Clean the text to remove tags for display
                line.text = line.text.replace(EnhancedLrcParser.SYLLABLE_REGEX, '').trim();
            }
        });

        return basicData;
    }

    private parseSyllables(text: string, lineStartTime: number): Syllable[] {
        const syllables: Syllable[] = [];


        // We need to capture the text BETWEEN tags.
        // Example: <00:01.00>Word<00:01.50>

        // Strategy: Split by regex, but include delimiters? 
        // Better: reset lastIndex and loop matchAll

        // Reset regex state just in case
        EnhancedLrcParser.SYLLABLE_REGEX.lastIndex = 0;

        const matches = [...text.matchAll(EnhancedLrcParser.SYLLABLE_REGEX)];

        if (matches.length === 0) return [];

        for (let i = 0; i < matches.length; i++) {
            const currentMatch = matches[i];
            const nextMatch = matches[i + 1];

            const minutes = parseInt(currentMatch[1], 10);
            const seconds = parseFloat(currentMatch[2]);
            const startTime = Math.round((minutes * 60 + seconds) * 1000);

            // Calculate relative start time
            // Spec 2.2.2.5 says Syllable contains "StartTime" (usually absolute in enhanced lrc context, 
            // but the interface defines it as "Relative start time in ms from the beginning of the line"?? 
            // Wait, checking my own LyricsData.ts definition: "Relative start time in ms from the beginning of the line"
            const relativeStartTime = startTime - lineStartTime;

            // Text associated with this timestamp is usually AFTER the tag until the next tag.
            const contentStartIndex = currentMatch.index! + currentMatch[0].length;
            const contentEndIndex = nextMatch ? nextMatch.index! : text.length;
            const syllableText = text.substring(contentStartIndex, contentEndIndex);

            // Duration calculation
            let duration = 0;
            if (nextMatch) {
                const nextMin = parseInt(nextMatch[1], 10);
                const nextSec = parseFloat(nextMatch[2]);
                const nextTime = Math.round((nextMin * 60 + nextSec) * 1000);
                duration = nextTime - startTime;
            } else {
                // Last syllable duration is unknown or until end of line? 
                // Usually we guess or leave 0.
                duration = 0;
            }

            syllables.push({
                startTime: relativeStartTime, // Using relative as defined in model
                duration: Math.max(0, duration),
                text: syllableText
            });
        }

        return syllables;
    }
}
