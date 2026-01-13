import { LyricsParser } from "../interfaces/LyricsParser";
import { StandardLrcParser } from "../parsers/StandardLrcParser";
import { EnhancedLrcParser } from "../parsers/EnhancedLrcParser";
import { QrcParser } from "../parsers/QrcParser";
import { LyricsData } from "../models/LyricsData";

/**
 * Utility to detect different types of lyrics by parsing their content.
 */
export class LyricTypeDetector {
    private static parsers: LyricsParser[] = [
        new QrcParser(),
        new EnhancedLrcParser(),
        new StandardLrcParser()
    ];

    /**
     * Parse lyric text and return the parsed data.
     * Uses the same parsing logic as LyricsManager.
     */
    private static parseLyricText(text: string): LyricsData | null {
        for (const parser of this.parsers) {
            try {
                const data = parser.parse(text);
                if (data && data.lines.length > 0) {
                    return data;
                }
            } catch (e) {
                // Continue to next parser
            }
        }
        return null;
    }

    /**
     * Check if lyrics contain translation (layer 1 lines).
     */
    static hasTranslation(lyricText: string): boolean {
        const data = this.parseLyricText(lyricText);
        if (!data) return false;

        return data.lines.some(line => line.layer === 1);
    }

    /**
     * Check if lyrics have word-level synchronization (karaoke).
     */
    static hasKaraoke(lyricText: string): boolean {
        const data = this.parseLyricText(lyricText);
        if (!data) return false;

        return data.lines.some(line => line.syllables && line.syllables.length > 0);
    }

    /**
     * Check if lyrics are plain text (unsynced).
     */
    static isPlainText(lyricText: string): boolean {
        const data = this.parseLyricText(lyricText);
        if (!data) return false;

        return data.isSynced === false;
    }

    /**
     * Get all type flags for a lyric at once.
     */
    /**
     * Get all type flags for a lyric at once.
     */
    static getLyricTypes(lyricText: string, translationText?: string): {
        hasTranslation: boolean;
        hasKaraoke: boolean;
        isPlainText: boolean;
    } {
        const fullText = translationText ? lyricText + "\n" + translationText : lyricText;
        const data = this.parseLyricText(fullText);

        if (!data) {
            return {
                hasTranslation: false,
                hasKaraoke: false,
                isPlainText: false
            };
        }

        return {
            hasTranslation: data.lines.some(line => line.layer === 1),
            hasKaraoke: data.lines.some(line => line.syllables && line.syllables.length > 0),
            isPlainText: data.isSynced === false
        };
    }
}
