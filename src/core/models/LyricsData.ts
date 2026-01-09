/**
 * Represents a single syllable/word with precise timing.
 * Spec Reference: 2.2.2.5
 */
export interface Syllable {
    /** Relative start time in ms from the beginning of the line */
    startTime: number;

    /** Duration of this syllable in ms */
    duration: number;

    /** Text content */
    text: string;
}

/**
 * Represents a single line of lyrics.
 */
export interface LyricsLine {
    /** Absolute start time in ms */
    startTime: number;

    /** Text content */
    text: string;

    /** 
     * Optional list of syllables for word-level sync.
     * Only populated if parsing 'Enhanced LRC'.
     */
    syllables?: Syllable[];

    /**
     * Represents the logical grouping (Original, Translation, Romaji).
     * Spec Reference: 2.2.2.4 "Grouping"
     * 0 = Primary, 1 = Translation, 2 = Romaji
     */
    layer: number;
}

/**
 * Represents the complete parsed lyrics data.
 */
export interface LyricsData {
    lines: LyricsLine[];

    /**
     * Metadata extracted from tags (e.g. [ti:Title], [ar:Artist]).
     * Key-value format.
     */
    metadata: Record<string, string>;
}
