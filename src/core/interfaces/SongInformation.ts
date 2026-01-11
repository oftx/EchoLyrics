/**
 * Represents the metadata of a music track.
 * Spec Reference: 2.1
 */
export interface SongInformation {
    /** 
     * Track title 
     */
    title: string;

    /** 
     * List of artists. 
     * Note: Spec 2.1 mandates array format, handling delimiters like '/' or '&' should be done upstream.
     */
    artists: string[];

    /** 
     * Album name 
     */
    album: string;

    /**
     * Embedded lyrics text (if available from metadata)
     */
    lyrics?: string;

    /** 
     * Track duration in milliseconds. 
     * Spec 2.1 mentions TimeSpan/long, here simplified to number (ms) for JS/TS.
     */
    duration: number;

    /** 
     * Base64 encoded image data or URL. 
     */
    albumArt?: string | Uint8Array;

    /** 
     * Unique identifier for the source (e.g. file path, Spotify ID).
     */
    sourceId: string;

    /**
     * Optional stable ID for persistence (e.g. filename).
     * Used for caching overrides instead of title/artist.
     */
    persistenceId?: string;

    /**
     * International Standard Recording Code
     */
    isrc?: string;
}
