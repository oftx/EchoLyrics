import { Logger } from "../utils/Logger";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";
import { SearchQueryResolver } from "../utils/SearchQueryResolver";


export class QQMusicNetworkProvider implements LyricsProvider {
    public name = "QQ Music";
    private readonly API_BASE = "/api/qq";
    private readonly API_DECRYPT = "/api/qq-decrypt";

    // QRC Parser instance

    private resolver = new SearchQueryResolver();

    public async search(song: SongInformation, limit: number = 8): Promise<LyricResult[]> {
        const uniqueQueries = await this.resolver.resolveQueries(song);
        const allResults: LyricResult[] = [];

        for (const query of uniqueQueries) {
            const results = await this.doSearch(query.title, query.artist, limit);
            if (results.length > 0) {
                Logger.info(`[QQMusic] Found results for query "${query.title} - ${query.artist}". Stopping loop.`);
                return results;
            }
        }
        return allResults;
    }

    private async doSearch(title: string, artist: string, limit: number): Promise<LyricResult[]> {
        try {
            const artistPart = artist ? ` ${artist}` : "";
            const keyword = `${title}${artistPart}`;

            // QQ Music Search API
            const searchUrl = `${this.API_BASE}/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&n=${limit}&format=json`;

            Logger.info(`[QQMusic] Searching: ${searchUrl}`);

            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();

            if (!searchData.data || !searchData.data.song || !searchData.data.song.list) {
                Logger.warn(`[QQMusic] No songs found or API error. Code: ${searchData.code}`);
                return [];
            }

            const searchResults = searchData.data.song.list;
            Logger.info(`[QQMusic] Found ${searchResults.length} candidates. Fetching lyrics...`);

            return await this.processSearchResults(searchResults);

        } catch (error) {
            Logger.error("QQMusic search error:", error);
            return [];
        }
    }

    private async processSearchResults(results: any[]): Promise<LyricResult[]> {
        const promises = results.map(async (track: any) => {
            // Use local decryption middleware with full metadata for QRC fetching
            const artistName = track.singer ? track.singer[0].name : "Unknown";
            const duration = track.interval || 0;
            const params = new URLSearchParams({
                songmid: track.songmid,
                songid: track.songid,
                title: track.songname,
                artist: artistName,
                album: track.albumname,
                duration: String(duration)
            });
            const lyricUrl = `${this.API_DECRYPT}?${params.toString()}`;

            try {
                const res = await fetch(lyricUrl);
                if (!res.ok) throw new Error(`Status ${res.status}`);
                const json = await res.json();

                if (json.lyric || json.trans) {
                    let lyricText = "";
                    let translationText = undefined;

                    // Prefer QRC (Already decrypted by middleware to XML string)
                    if (json.lyric) {
                        lyricText = json.lyric;
                    }

                    if (json.trans) {
                        // Translation is usually LRC
                        translationText = json.trans;
                    }

                    return {
                        id: String(track.songmid),
                        title: track.songname,
                        artist: track.singer ? track.singer.map((s: any) => s.name).join(", ") : "Unknown",
                        album: track.albumname,
                        duration: track.interval,
                        lyricText: lyricText, // Raw decrypted QRC or LRC
                        translationText: translationText,
                        source: this.name,
                        score: 0
                    } as LyricResult;
                }
            } catch (e) {
                Logger.warn(`[QQMusic] Error fetching lyric for ${track.songmid}`, e);
            }
            return null;
        });

        const resolved = await Promise.all(promises);
        return resolved.filter((r): r is LyricResult => r !== null);
    }
}
