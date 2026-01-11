import { Logger } from "./Logger";
import { SongInformation } from "../interfaces/SongInformation";
import { calculateSimilarity } from "./Levenshtein";

export class SearchQueryResolver {
    private readonly MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2";
    // Cache stores the Promise of the result to handle concurrent requests (request coalescing)
    private static isrcCache = new Map<string, Promise<{ title: string; artist: string }[]>>();

    /**
     * Resolves a list of prioritized queries for a song.
     * Strategy:
     * 1. If ISRC is present, fetch metadata from MusicBrainz and prioritize by language (CN > JP > EN).
     * 2. Check if the original song.title matches one of the MB results (Similarity check).
     * 3. If similarity is low (< 0.8), it implies a Manual Override (User typed something different).
     *    Link the manual input as the *Primary* query.
     * 4. If no ISRC or no results, fallback to simple "Title Artist" query.
     */
    public async resolveQueries(song: SongInformation): Promise<{ title: string; artist: string }[]> {
        let uniqueQueries: { title: string; artist: string }[] = [];
        let mbMetadata: { title: string; artist: string }[] = [];

        // Strategy 1: MusicBrainz Lookup (if ISRC exists)
        if (song.isrc) {
            let metadataPromise: Promise<{ title: string; artist: string }[]>;

            // Check cache first (for existing or in-flight request)
            if (SearchQueryResolver.isrcCache.has(song.isrc)) {
                Logger.info(`[SearchResolver] Cache hit (Promise) for ISRC: ${song.isrc}`);
                metadataPromise = SearchQueryResolver.isrcCache.get(song.isrc)!;
            } else {
                Logger.info(`[SearchResolver] ISRC found: ${song.isrc}. Querying MusicBrainz...`);
                // Create the promise and cache it immediately
                metadataPromise = this.fetchMusicBrainzMetadata(song.isrc);
                SearchQueryResolver.isrcCache.set(song.isrc, metadataPromise);
            }

            try {
                mbMetadata = await metadataPromise;
                if (mbMetadata.length > 0) {
                    // CLONE the array to prevent mutating the cached instance!
                    // sort() is in-place, and unshift() later would also modify the cache.
                    const candidates = [...mbMetadata];
                    uniqueQueries = this.sortMetadataByLanguage(candidates);

                    if (uniqueQueries.length > 0) {
                        Logger.info(`[SearchResolver] Resolved ${uniqueQueries.length} queries from MusicBrainz for ISRC: ${song.isrc}`);
                    }
                }
            } catch (e) {
                Logger.error(`[SearchResolver] Error resolving ISRC ${song.isrc}`, e);
            }
        }

        // Logic to detect Manual Override / Mismatch
        // If we have MB results, we check if the current input (song.title) is already in the results.
        let isManualOverride = false;

        if (uniqueQueries.length > 0) {
            // Check similarity against the best MB match (or all candidates)
            const inputTitle = song.title;
            // We use the highest similarity found among candidates
            let maxSim = 0;
            for (const candidate of uniqueQueries) {
                const sim = calculateSimilarity(inputTitle, candidate.title);
                if (sim > maxSim) maxSim = sim;
            }

            // If the best match is less than 0.8 similar, we assume the user input is "different enough"
            // to warrant being treated as an explicit search (Manual Override)
            if (maxSim < 0.8) {
                Logger.info(`[SearchResolver] Detected Manual Override/Mismatch (Max Similarity: ${maxSim.toFixed(2)}). Prioritizing input over MB results.`);
                isManualOverride = true;
            }
        } else {
            // No MB results, so definitely use input
            isManualOverride = true;
        }

        // Strategy 2: Fallback or Manual Override
        // If override, we prepend the input to the list.
        // If list is empty (no MB results), we naturally push input.
        if (isManualOverride || uniqueQueries.length === 0) {
            const artistPart = (song.artists && song.artists[0]) ? song.artists[0] : "";
            // Add to the front!
            const manualQuery = { title: song.title, artist: artistPart };

            // Avoid duplicates if we forcibly prepended but it WAS in the list (e.g. similarity was 0.79 but identical string? unlikely, but check exact title)
            const exists = uniqueQueries.some(q => q.title === manualQuery.title && q.artist === manualQuery.artist);
            if (!exists) {
                uniqueQueries.unshift(manualQuery);
            }
        }

        return uniqueQueries;
    }

    private async fetchMusicBrainzMetadata(isrc: string): Promise<{ title: string; artist: string }[]> {
        try {
            const url = `${this.MUSICBRAINZ_API_BASE}/recording?query=isrc:${isrc}&fmt=json`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'LyricsApp/1.0 ( contact@example.com )' // Replace with real app info if available
                }
            });

            if (!response.ok) {
                Logger.warn(`[SearchResolver] MusicBrainz lookup failed: ${response.status}`);
                return [];
            }

            const data = await response.json();
            if (!data.recordings) return [];

            const candidates: { title: string; artist: string }[] = [];
            const seen = new Set<string>();

            for (const recording of data.recordings) {
                const title = recording.title;
                const artist = recording['artist-credit']?.[0]?.name || "";

                const key = `${title}|${artist}`;
                if (title && !seen.has(key)) {
                    candidates.push({ title, artist });
                    seen.add(key);
                }
            }
            return candidates;

        } catch (e) {
            Logger.error("[SearchResolver] MusicBrainz connection error:", e);
            return [];
        }
    }

    private sortMetadataByLanguage(candidates: { title: string; artist: string }[]): { title: string; artist: string }[] {
        // Priority: CN (Chinese) > JP (Japanese) > EN (English/Other)

        const isChinese = (str: string) => /[\u4e00-\u9fa5]/.test(str) && !/[\u3040-\u309f\u30a0-\u30ff]/.test(str);
        const isJapanese = (str: string) => /[\u3040-\u309f\u30a0-\u30ff]/.test(str);

        return candidates.sort((a, b) => {
            const getPriority = (item: { title: string; artist: string }) => {
                const text = `${item.title} ${item.artist}`;
                if (isChinese(text)) return 3;
                if (isJapanese(text)) return 2;
                return 1;
            };

            return getPriority(b) - getPriority(a);
        });
    }
}
