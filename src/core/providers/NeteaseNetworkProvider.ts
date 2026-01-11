import { Logger } from "../utils/Logger";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";
import { SearchQueryResolver } from "../utils/SearchQueryResolver";

export class NeteaseNetworkProvider implements LyricsProvider {
    public name = "Netease Cloud Music";
    private readonly API_BASE = "/api/netease"; // Proxied path

    private resolver = new SearchQueryResolver();

    public async search(song: SongInformation, limit: number = 8): Promise<LyricResult[]> {
        const uniqueQueries = await this.resolver.resolveQueries(song);
        const allResults: LyricResult[] = [];

        for (const query of uniqueQueries) {
            const results = await this.doSearch(query.title, query.artist, limit);
            if (results.length > 0) {
                Logger.info(`[Netease] Found results for query "${query.title} - ${query.artist}". Stopping loop.`);
                return results;
            }
        }

        return allResults;
    }

    private async doSearch(title: string, artist: string, limit: number): Promise<LyricResult[]> {
        try {
            const artistPart = artist ? ` ${artist}` : "";
            const keyword = `${title}${artistPart}`;
            const searchUrl = `${this.API_BASE}/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=${limit}`;

            Logger.info(`[Netease] Searching: ${searchUrl}`);

            const searchResponse = await fetch(searchUrl);
            const searchData = await searchResponse.json();

            if (searchData.code !== 200 || !searchData.result || !searchData.result.songs) {
                Logger.warn(`[Netease] No songs found or API error. Code: ${searchData.code}`);
                return [];
            }

            const searchResults = searchData.result.songs;
            Logger.info(`[Netease] Found ${searchResults.length} candidates. Fetching lyrics...`);

            const lyricPromises = searchResults.map(async (track: any) => {
                const lyricUrl = `${this.API_BASE}/api/song/lyric?os=pc&id=${track.id}&lv=-1&kv=-1&tv=-1`;
                try {
                    const lyricResponse = await fetch(lyricUrl);
                    const lyricData = await lyricResponse.json();

                    if (lyricData.code === 200 && lyricData.lrc && lyricData.lrc.lyric) {
                        return {
                            id: String(track.id),
                            title: track.name,
                            // Note: cloudsearch uses 'ar' instead of 'artists'
                            artist: track.ar ? track.ar.map((a: any) => a.name).join(", ") :
                                (track.artists ? track.artists.map((a: any) => a.name).join(", ") : "Unknown"),
                            album: track.al ? track.al.name :
                                (track.album ? track.album.name : "Unknown"),
                            duration: track.dt || track.duration,
                            lyricText: lyricData.lrc.lyric,
                            source: this.name,
                            score: 0 // To be calculated
                        } as LyricResult;
                    }
                } catch (e) {
                    Logger.warn(`[Netease] Failed to fetch lyrics for ${track.id}`, e);
                }
                return null;
            });

            const results = await Promise.all(lyricPromises);
            const validResults = results.filter((r): r is LyricResult => r !== null);
            Logger.info(`[Netease] Fetched ${validResults.length} lyrics.`);
            return validResults;

        } catch (error) {
            Logger.error("Netease search error:", error);
            return [];
        }
    }
}
