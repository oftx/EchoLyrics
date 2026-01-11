import { Logger } from "../utils/Logger";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";

export class QQMusicNetworkProvider implements LyricsProvider {
    public name = "QQ Music";
    private readonly API_BASE = "/api/qq"; // Proxied path

    public async search(song: SongInformation, limit: number = 15): Promise<LyricResult[]> {
        try {
            const artistPart = (song.artists && song.artists[0]) ? ` ${song.artists[0]}` : "";
            const keyword = `${song.title}${artistPart}`;

            // QQ Music Search API
            // w: keyword
            // n: limit
            // format: json
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



            // Re-implementing with cleaner logic below
            return await this.processSearchResults(searchResults);

        } catch (error) {
            Logger.error("QQMusic search error:", error);
            return [];
        }
    }

    private async processSearchResults(results: any[]): Promise<LyricResult[]> {
        const promises = results.map(async (track: any) => {
            // Use base64 response for safety
            const lyricUrl = `${this.API_BASE}/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${track.songmid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`;

            try {
                const res = await fetch(lyricUrl);
                let text = await res.text();

                // Handle JSONP
                const jsonMatch = text.match(/\{.*\}/);
                if (!jsonMatch) return null;

                const json = JSON.parse(jsonMatch[0]);

                if (json.lyric) {
                    // Decode Base64
                    try {
                        const decodedUtils = atob(json.lyric);
                        return {
                            id: String(track.songmid),
                            title: track.songname,
                            artist: track.singer ? track.singer.map((s: any) => s.name).join(", ") : "Unknown",
                            album: track.albumname,
                            duration: track.interval, // seconds to ms? Input seems to be seconds.
                            lyricText: decodedUtils,
                            source: this.name,
                            score: 0
                        } as LyricResult;
                    } catch (e) {
                        Logger.warn("Failed to decode base64 lyric", e);
                    }
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
