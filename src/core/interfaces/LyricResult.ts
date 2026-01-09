/**
 * Represents a search result from a lyrics provider.
 * Spec Reference: 2.3.1
 */
export interface LyricResult {
    /** 
     * The raw text content of the lyrics (LRC or plain text).
     */
    lyricText: string;

    /**
     * Provider source identifier (e.g. "Local", "Netease").
     */
    source: string;

    /**
     * Calculated match score (0-100).
     */
    score: number;

    /**
     * Optional ID on the source platform.
     */
    id?: string;

    /**
     * Title as found on the provider (for verifying match).
     */
    title?: string;

    /**
     * Artist as found on the provider.
     */
    artist?: string;

    /**
     * Album as found on the provider.
     */
    album?: string;

    /**
     * Duration in ms (if available).
     */
    duration?: number;
}

