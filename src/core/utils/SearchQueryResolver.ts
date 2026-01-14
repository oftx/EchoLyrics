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

        // Fallback: Search by Name if ISRC missing or yielded no results
        if ((!song.isrc || uniqueQueries.length === 0) && song.title && song.artists && song.artists.length > 0) {
            const artist = song.artists[0];
            const cacheKey = `NAME:${song.title}|${artist}`;
            let metadataPromise: Promise<{ title: string; artist: string }[]>;

            if (SearchQueryResolver.isrcCache.has(cacheKey)) {
                metadataPromise = SearchQueryResolver.isrcCache.get(cacheKey)!;
            } else {
                Logger.info(`[SearchResolver] No ISRC or no ISRC results. Searching MusicBrainz by name: ${song.title} - ${artist}`);
                metadataPromise = this.fetchMusicBrainzMetadataByName(song.title, artist);
                SearchQueryResolver.isrcCache.set(cacheKey, metadataPromise);
            }

            try {
                const nameMetadata = await metadataPromise;
                if (nameMetadata.length > 0) {
                    const candidates = [...nameMetadata];
                    uniqueQueries = this.sortMetadataByLanguage(candidates);
                    Logger.info(`[SearchResolver] Resolved ${uniqueQueries.length} queries from MusicBrainz by name.`);
                }
            } catch (e) {
                Logger.error(`[SearchResolver] Error resolving by name ${song.title}`, e);
            }
        }

        // Logic to detect Manual Override / Mismatch
        let isManualOverride = false;
        const isAutoSearch = song.sourceId === 'local_auto' || (song.sourceId && song.sourceId.includes('auto'));

        if (uniqueQueries.length > 0) {
            const inputTitle = song.title;
            let maxSim = 0;
            for (const candidate of uniqueQueries) {
                const sim = calculateSimilarity(inputTitle, candidate.title);
                if (sim > maxSim) maxSim = sim;
            }

            // If Similarity < 0.8, we usually assume Manual Override.
            // But if it's an Auto Search, we trust the MB result (which is likely correct) over the local file tag.
            if (inputTitle && maxSim < 0.8) {
                if (!isAutoSearch) {
                    Logger.info(`[SearchResolver] Detected Manual Override/Mismatch (Max Similarity: ${maxSim.toFixed(2)}). Prioritizing input over MB results.`);
                    isManualOverride = true;
                } else {
                    Logger.info(`[SearchResolver] Low similarity (${maxSim.toFixed(2)}) detected in Auto Search. Trusting MB results over local metadata.`);
                }
            }
        } else {
            // No MB results, always use input
            isManualOverride = true;
        }

        // Apply Manual Override or Fallback
        if (isManualOverride || uniqueQueries.length === 0) {
            const artistPart = (song.artists && song.artists[0]) ? song.artists[0] : "";
            const manualQuery = { title: song.title, artist: artistPart };

            const exists = uniqueQueries.some(q => q.title === manualQuery.title && q.artist === manualQuery.artist);
            if (!exists) {
                // If override, PREPEND.
                uniqueQueries.unshift(manualQuery);
            }
        } else if (isAutoSearch && uniqueQueries.length > 0) {
            // In Auto Search, if we found MB results, we still append the local file metadata as a fallback at the end.
            const artistPart = (song.artists && song.artists[0]) ? song.artists[0] : "";
            const manualQuery = { title: song.title, artist: artistPart };
            const exists = uniqueQueries.some(q => q.title === manualQuery.title && q.artist === manualQuery.artist);
            if (!exists) {
                uniqueQueries.push(manualQuery);
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
            return this.parseMusicBrainzResponse(data);

        } catch (e) {
            Logger.error("[SearchResolver] MusicBrainz connection error:", e);
            return [];
        }
    }

    private async fetchMusicBrainzMetadataByName(title: string, artist: string): Promise<{ title: string; artist: string }[]> {
        try {
            const query = `recording:${title} AND artist:${artist}`;
            const url = `${this.MUSICBRAINZ_API_BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
            Logger.info(`[SearchResolver] Querying MusicBrainz by name: ${url}`);

            const response = await fetch(url, { headers: { 'User-Agent': 'LyricsApp/1.0 ( contact@example.com )' } });
            if (!response.ok) {
                Logger.warn(`[SearchResolver] MusicBrainz name lookup failed: ${response.status}`);
                return [];
            }
            const data = await response.json();
            return this.parseMusicBrainzResponse(data);
        } catch (e) {
            Logger.error("[SearchResolver] MusicBrainz name lookup error:", e);
            return [];
        }
    }

    private parseMusicBrainzResponse(data: any): { title: string; artist: string }[] {
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
