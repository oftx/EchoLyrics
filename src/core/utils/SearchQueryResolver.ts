import { Logger } from "./Logger";
import { SongInformation } from "../interfaces/SongInformation";

export class SearchQueryResolver {
    private readonly MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2";
    // Cache stores the Promise of the result to handle concurrent requests (request coalescing)
    private static isrcCache = new Map<string, Promise<{ title: string; artist: string }[]>>();

    /**
     * Resolves a list of prioritized queries for a song.
     * Strategy:
     * 1. If ISRC is present, fetch metadata from MusicBrainz and prioritize by language (CN > JP > EN).
     * 2. If no ISRC or no results, fallback to simple "Title Artist" query.
     */
    public async resolveQueries(song: SongInformation): Promise<{ title: string; artist: string }[]> {
        let uniqueQueries: { title: string; artist: string }[] = [];

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
                const mbMetadata = await metadataPromise;
                if (mbMetadata.length > 0) {
                    uniqueQueries = this.sortMetadataByLanguage(mbMetadata);
                    if (uniqueQueries.length > 0) {
                        Logger.info(`[SearchResolver] Resolved ${uniqueQueries.length} queries from MusicBrainz for ISRC: ${song.isrc}`);
                    }
                }
            } catch (e) {
                Logger.error(`[SearchResolver] Error resolving ISRC ${song.isrc}`, e);
            }
        }

        // Strategy 2: Fallback to original metadata if no MusicBrainz results or no ISRC
        if (uniqueQueries.length === 0) {
            const artistPart = (song.artists && song.artists[0]) ? song.artists[0] : "";
            uniqueQueries.push({ title: song.title, artist: artistPart });
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
