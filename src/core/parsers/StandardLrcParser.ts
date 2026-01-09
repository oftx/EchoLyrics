import { LyricsParser } from "../interfaces/LyricsParser";
import { LyricsData, LyricsLine } from "../models/LyricsData";

/**
 * Parses standard LRC format `[mm:ss.xx]Text`.
 * Spec Reference: 2.2.1 Sample 1
 */
export class StandardLrcParser implements LyricsParser {
    // Regex to match [mm:ss.xx] or [mm:ss.xxx]
    // Group 1: mm, Group 2: ss.xx
    private static TIMESTAMP_REGEX = /\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\]/g;
    private static META_REGEX = /\[([a-zA-Z]+):([^\]]+)\]/;

    public parse(rawText: string): LyricsData {
        const lines: LyricsLine[] = [];
        const metadata: Record<string, string> = {};

        // 1. Normalize line endings
        const rawLines = rawText.split(/\r?\n/);

        // Pre-processing for duplicate timestamps grouping (Spec 2.2.2.4)
        // We will store all parsed entries and then sort/group them.
        const parsedEntries: { time: number; text: string; rawIndex: number }[] = [];

        rawLines.forEach((line, index) => {
            line = line.trim();
            if (!line) return;

            // Check for metadata
            const metaMatch = line.match(StandardLrcParser.META_REGEX);
            if (metaMatch && !StandardLrcParser.TIMESTAMP_REGEX.test(line)) {
                // If it looks like ID metadata and NOT a lyrics line containing timestamps
                // Note: Some lyrics might look like [00:01.00][meta:value] which is rare but possible.
                // Spec 2.2.2.3 says Content is after tags.
                // Safest way: if line starts with non-digit tag.
                const key = metaMatch[1];
                const value = metaMatch[2].trim();
                metadata[key] = value;
                return;
            }

            // Extract all timestamps in the line (handles [00:01][00:10]Repeated lyrics)
            const matches = [...line.matchAll(StandardLrcParser.TIMESTAMP_REGEX)];

            if (matches.length > 0) {
                // Remove all timestamps to get the lyrics text
                const text = line.replace(StandardLrcParser.TIMESTAMP_REGEX, '').trim();

                for (const match of matches) {
                    const minutes = parseInt(match[1], 10);
                    const seconds = parseFloat(match[2]);
                    const timeMs = Math.round((minutes * 60 + seconds) * 1000);

                    parsedEntries.push({
                        time: timeMs,
                        text: text,
                        rawIndex: index
                    });
                }
            }
        });

        // Sort by time
        parsedEntries.sort((a, b) => a.time - b.time);

        // Grouping logic (Spec 2.2.2.4)
        // If start times are identical, assign layers.
        // We need to iterate and check for overlaps.

        // Simple grouping strategy:
        // Iterate through sorted entries. If current.time == previous.time, increment layer.

        if (parsedEntries.length > 0) {
            let currentGroupTime = -1;
            let currentLayer = 0;

            for (const entry of parsedEntries) {
                if (Math.abs(entry.time - currentGroupTime) < 1) { // 1ms tolerance
                    currentLayer++;
                } else {
                    currentGroupTime = entry.time;
                    currentLayer = 0;
                }

                // Handling the stack limit mentioned in Spec 2.2.2.4 (Max 3 layers usually)
                // Spec says: Original(0) -> Trans(1) -> Romaji(2) -> Extra trans...
                // We just assign the layer number.

                lines.push({
                    startTime: entry.time,
                    text: entry.text,
                    layer: currentLayer
                });
            }
        }

        return {
            lines,
            metadata
        };
    }
}
