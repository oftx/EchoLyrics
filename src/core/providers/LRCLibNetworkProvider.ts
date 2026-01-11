import { Logger } from "../utils/Logger";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";

export class LRCLibNetworkProvider implements LyricsProvider {
    public name = "LRCLIB";
    private readonly API_BASE = "/api/lrclib";

    public async search(song: SongInformation, limit: number = 15): Promise<LyricResult[]> {
        try {
            // Strategy 1: Text Search (Fuzzy)
            const artistPart = (song.artists && song.artists[0]) ? song.artists[0] : "";
            const query = `${song.title} ${artistPart}`.trim();
            const searchUrl = `${this.API_BASE}/search?q=${encodeURIComponent(query)}`;

            Logger.info(`[LRCLIB] Searching by Text: ${searchUrl}`);

            const response = await fetch(searchUrl);
            if (!response.ok) {
                Logger.warn(`[LRCLIB] Search failed with status ${response.status}`);
                return [];
            }

            const data = await response.json();
            if (Array.isArray(data)) {
                Logger.info(`[LRCLIB] Found ${data.length} candidates.`);
                return data.slice(0, limit).map((item) => this.mapToLyricResult(item));
            }

            return [];

        } catch (error) {
            Logger.error("LRCLIB search error:", error);
            return [];
        }
    }

    private mapToLyricResult(item: any): LyricResult {
        return {
            id: String(item.id),
            title: item.trackName,
            artist: item.artistName,
            album: item.albumName,
            duration: item.duration * 1000, // lrclib returns seconds
            lyricText: item.syncedLyrics || item.plainLyrics || "",
            source: this.name,
            score: 0
        } as LyricResult;
    }
}
