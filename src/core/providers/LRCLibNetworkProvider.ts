import { Logger } from "../utils/Logger";
import { LyricsProvider } from "../interfaces/LyricsProvider";
import { LyricResult } from "../interfaces/LyricResult";
import { SongInformation } from "../interfaces/SongInformation";
import { SearchQueryResolver } from "../utils/SearchQueryResolver";

export class LRCLibNetworkProvider implements LyricsProvider {
    public name = "LRCLIB";
    private readonly API_BASE = "/api/lrclib";
    private resolver = new SearchQueryResolver();

    public async search(song: SongInformation, limit: number = 8): Promise<LyricResult[]> {
        const uniqueQueries = await this.resolver.resolveQueries(song);
        const allResults: LyricResult[] = [];

        for (const query of uniqueQueries) {
            const results = await this.doSearch(query.title, query.artist, limit);
            if (results.length > 0) {
                // Return found results immediately as proper prioritization is handled by resolver
                Logger.info(`[LRCLIB] Found results for query "${query.title} - ${query.artist}". Stopping loop.`);
                return results;
            }
        }

        return allResults;
    }

    private async doSearch(title: string, artist: string, limit: number): Promise<LyricResult[]> {
        try {
            const query = `${title} ${artist}`.trim();
            const searchUrl = `${this.API_BASE}/search?q=${encodeURIComponent(query)}`;

            Logger.info(`[LRCLIB] Searching: ${searchUrl}`);

            const response = await fetch(searchUrl);
            if (!response.ok) {
                Logger.warn(`[LRCLIB] Search failed with status ${response.status}`);
                return [];
            }

            const data = await response.json();
            if (Array.isArray(data)) {
                return data.slice(0, limit).map((item) => this.mapToLyricResult(item));
            }
            return [];
        } catch (error) {
            Logger.error(`[LRCLIB] Search error for "${title} - ${artist}":`, error);
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
