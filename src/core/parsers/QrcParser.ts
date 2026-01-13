import { LyricsParser } from "../interfaces/LyricsParser";
import { LyricsData, LyricsLine } from "../models/LyricsData";

export class QrcParser implements LyricsParser {
    public parse(rawText: string): LyricsData {
        const lines: LyricsLine[] = [];
        const metadata: Record<string, string> = {};

        // 1. Extract content from XML if present
        let qrcContent = rawText;
        const xmlMatch = rawText.match(/LyricContent="([^"]*)"/);
        if (xmlMatch) {
            qrcContent = xmlMatch[1];
        }

        const rawLines = qrcContent.split(/\r?\n/);

        rawLines.forEach((line) => {
            line = line.trim();
            if (!line) return;

            // Metadata Match
            const metaMatch = line.match(/^\[([a-z]+):(.*)\]$/);
            if (metaMatch) {
                metadata[metaMatch[1]] = metaMatch[2];
                return;
            }

            // Line Match: [start, duration]Words...
            // Regex to find the start tag
            const lineStartMatch = line.match(/^\[(\d+),(\d+)\](.*)/);
            if (lineStartMatch) {
                const lineStartTime = parseInt(lineStartMatch[1], 10);
                // const lineDuration = parseInt(lineStartMatch[2], 10);
                const content = lineStartMatch[3];

                const syllables: import("../models/LyricsData").Syllable[] = [];
                let plainText = "";

                // Regex for word tokens: Text(start,dur)
                const wordRegex = /([^(]*)\((\d+),(\d+)\)/g;
                let match;

                while ((match = wordRegex.exec(content)) !== null) {
                    const wordText = match[1];
                    const wordAbsStart = parseInt(match[2], 10);
                    const wordDur = parseInt(match[3], 10);

                    plainText += wordText;

                    syllables.push({
                        text: wordText,
                        startTime: Math.max(0, wordAbsStart - lineStartTime),
                        duration: wordDur
                    });
                }

                // If content looks like QRC line but regex loop didn't run (e.g. no word timestamps?)
                // Or trailing text?
                if (syllables.length === 0 && content.trim().length > 0) {
                    plainText = content;
                }

                lines.push({
                    startTime: lineStartTime,
                    text: plainText,
                    syllables: syllables.length > 0 ? syllables : undefined,
                    layer: 0
                });
            }
        });

        lines.sort((a, b) => a.startTime - b.startTime);

        return {
            lines,
            metadata,
            isSynced: lines.length > 0
        };
    }
}
