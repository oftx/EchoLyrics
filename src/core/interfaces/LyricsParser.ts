import { LyricsData } from "../models/LyricsData";

/**
 * Interface for lyrics parsing strategies.
 * Design Pattern: Strategy Pattern.
 */
export interface LyricsParser {
    /**
     * Parses raw lyrics text into structured data.
     * @param rawText The content of the lyrics file.
     * @returns Parsed LyricsData object.
     */
    parse(rawText: string): LyricsData;
}
