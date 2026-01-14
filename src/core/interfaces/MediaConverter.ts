export interface MediaConverter {
    load(): Promise<void>;

    /**
     * Converts a file (e.g. m4a/alac) to a WAV Blob.
     * Also captures embedded lyrics from conversion logs if available.
     */
    convertToWav(file: File): Promise<{ blob: Blob; lyrics?: string }>;

    /**
     * Probes the file to extract metadata (specifically lyrics) from logs.
     */
    readMetadata(file: File): Promise<{ lyrics?: string }>;
}
