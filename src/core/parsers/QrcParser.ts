import { LyricsParser } from "../interfaces/LyricsParser";
import { LyricsData, LyricsLine } from "../models/LyricsData";

export class QrcParser implements LyricsParser {
    public parse(rawText: string): LyricsData {
        const lines: LyricsLine[] = [];
        const metadata: Record<string, string> = {};

        // 1. Extract content from XML if present


        const rawLines = rawText.split(/\r?\n/);

        rawLines.forEach((line) => {
            line = line.trim();
            if (!line) return;

            // 1. Try QRC Line Match (inside XML usually, but we might just regex the whole rawText)
            // QRC Format: [timestamp,duration]content
            const qrcMatch = line.match(/^\[(\d+),(\d+)\](.*)/);
            if (qrcMatch) {
                const lineStartTime = parseInt(qrcMatch[1], 10);
                const content = qrcMatch[3];

                const syllables: import("../models/LyricsData").Syllable[] = [];
                let plainText = "";

                // Regex for word tokens: Text(start,dur)
                // Use non-greedy match (.*?) to allow '(' inside the text itself (e.g., "(Vocals)")
                const wordRegex = /(.*?)\((\d+),(\d+)\)/g;
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

                if (syllables.length === 0 && content.trim().length > 0) {
                    plainText = content;
                }

                lines.push({
                    startTime: lineStartTime,
                    text: plainText,
                    syllables: syllables.length > 0 ? syllables : undefined,
                    layer: 0
                });
                return;
            }

            // 2. Try Standard LRC Match (Translation)
            // Format: [mm:ss.xx]Text
            const lrcMatch = line.match(/^\[(\d+):(\d+)(\.(\d+))?\](.*)/);
            if (lrcMatch) {
                const minutes = parseInt(lrcMatch[1], 10);
                const seconds = parseInt(lrcMatch[2], 10);
                const msPart = lrcMatch[4] ? parseInt(lrcMatch[4].padEnd(3, '0').slice(0, 3), 10) : 0;
                const time = minutes * 60 * 1000 + seconds * 1000 + msPart;
                const text = lrcMatch[5];

                if (text.trim()) {
                    lines.push({
                        startTime: time,
                        text: text,
                        layer: 1 // Translation Layer
                    });
                }
                return;
            }

            // 3. Metadata Match
            const metaMatch = line.match(/^\[([a-z]+):(.*)\]$/);
            if (metaMatch) {
                metadata[metaMatch[1]] = metaMatch[2];
            }
        });

        lines.sort((a, b) => a.startTime - b.startTime);

        // Validation: If we have lines but NONE are Layer 0 (QRC),
        // then this is likely a standard LRC file that we mistakenly parsed as "All Translations".
        // In this case, we should return empty/unsynced so the StandardLrcParser can handle it correctly as Layer 0.
        const hasQrcLayer = lines.some(l => l.layer === 0);
        if (lines.length > 0 && !hasQrcLayer) {
            return { lines: [], metadata: {}, isSynced: false };
        }

        // Post-process: Match translation lines (Layer 1) to their closest QRC line (Layer 0)
        // by timestamp proximity, and align their timestamps for correct pairing
        const qrcLines = lines.filter(l => l.layer === 0);
        const translationLines = lines.filter(l => l.layer === 1);

        const TIMESTAMP_TOLERANCE = 300; // 300ms tolerance for matching

        // For each translation, find the closest QRC line and snap to its timestamp
        const matched = new Set<number>();
        translationLines.forEach(trans => {
            let closestIdx = -1;
            let minDiff = Infinity;

            qrcLines.forEach((qrc, idx) => {
                const diff = Math.abs(qrc.startTime - trans.startTime);
                if (diff < minDiff && diff <= TIMESTAMP_TOLERANCE) {
                    minDiff = diff;
                    closestIdx = idx;
                }
            });

            if (closestIdx !== -1 && !matched.has(closestIdx)) {
                // Snap translation timestamp to match QRC timestamp exactly
                matched.add(closestIdx);
                trans.startTime = qrcLines[closestIdx].startTime;
            }
        });

        // Remove unmatched translations (orphaned) and combine
        const finalLines = [
            ...qrcLines,
            ...translationLines.filter(trans => {
                // Keep only translations that were matched
                return qrcLines.some(qrc => qrc.startTime === trans.startTime);
            })
        ];

        // Sort: First by timestamp, then by layer (0 before 1)
        finalLines.sort((a, b) => {
            if (a.startTime === b.startTime) {
                return (a.layer || 0) - (b.layer || 0);
            }
            return a.startTime - b.startTime;
        });

        return {
            lines: finalLines,
            metadata,
            isSynced: finalLines.length > 0
        };
    }
}
