import { Logger } from "../utils/Logger";
import { LyricsSearcherService } from "./LyricsSearcherService";
import { PlaybackSynchronizer } from "./PlaybackSynchronizer";
import { LyricsParser } from "../interfaces/LyricsParser";
import { StandardLrcParser } from "../parsers/StandardLrcParser";
import { EnhancedLrcParser } from "../parsers/EnhancedLrcParser";
import { LyricsData } from "../models/LyricsData";
import { SongInformation } from "../interfaces/SongInformation";


/**
 * Main facade for the UI to interact with.
 * Manages search, parsing, and state.
 */
export class LyricsManager {
    private searcher = new LyricsSearcherService();
    private synchronizer = new PlaybackSynchronizer();
    private parsers: LyricsParser[] = [
        new EnhancedLrcParser(), // Try enhanced first
        new StandardLrcParser()
    ];

    private currentLyrics: LyricsData | null = null;
    private lastResults: import("../interfaces/LyricResult").LyricResult[] = [];
    private currentSongKey: string = "";

    private readonly STORAGE_KEY = "echo_lyrics_cache_v1";



    constructor() {
        // Init default parsers? yes.
    }

    public getSearcher(): LyricsSearcherService {
        return this.searcher;
    }

    public getSynchronizer(): PlaybackSynchronizer {
        return this.synchronizer;
    }

    /**
     * Parses the given text using available parsers.
     * @param text Raw lyrics text.
     */
    public parse(text: string): LyricsData {
        // Try all parsers. In reality, we might check format first.
        // EnhancedParser falls back to Standard if no tags found (implemented in EnhancedLrcParser),
        // so we can just use EnhancedParser as primary.
        const parser = this.parsers[0];
        const data = parser.parse(text);
        this.currentLyrics = data;
        return data;
    }



    public getCurrentLyrics(): LyricsData | null {
        return this.currentLyrics;
    }

    /**
     * High level method to load lyrics for a song.
     * @param song Song Metadata
     * @param options.ignoreCache If true, bypasses the search cache (forces new search).
     * @param options.limit Max results.
     */
    public async loadLyricsForSong(song: SongInformation, options?: { ignoreCache?: boolean, limit?: number, localFileContent?: string }): Promise<boolean> {
        this.lastResults = []; // Clear previous
        const limit = options?.limit || 15;

        // Key for PERSISTENCE (Which result did I choose for this file?)
        // Prefer persistenceId (filename) if available.
        const persistenceKey = song.persistenceId ? song.persistenceId : `${song.title}|${song.artists.join(',')}`;
        this.currentSongKey = persistenceKey;

        // Key for SEARCH CACHE (What results do I have for this query?)
        const artistPart = (song.artists && song.artists[0]) ? `|${song.artists[0]}` : "";
        const searchKey = `SEARCH:${song.title}${artistPart}|LIMIT:${limit}`;

        Logger.info(`[LyricsManager] LoadLyrics. PersistenceKey: ${persistenceKey}. SearchKey: ${searchKey}. IgnoreCache: ${options?.ignoreCache}`);

        const cache = this.loadCache();

        // 1. Check for SAVED SELECTION (Persistence) always (unless we want to force re-search to verify?)
        // Actually, if user says "ignoreCache", they usually mean "I want to SEARCH again", not "Forget my selection".
        // But if they search manually, they want to see the LIST.
        // So if ignoreCache is true, we skip auto-selecting the saved result.

        // 1. Check for Embedded Lyrics (Priority 1)
        if (song.lyrics) {
            Logger.info(`[LyricsManager] Found embedded lyrics for ${song.title}`);
            const embeddedResult: import("../interfaces/LyricResult").LyricResult = {
                id: "embedded_" + Date.now(),
                lyricText: song.lyrics,
                source: "Embedded (ID3)",
                score: 100,
                title: song.title,
                artist: song.artists.join(", "),
                duration: song.duration
            };

            // If forcing search (ignoreCache), we just add it to candidates list below.
            // But if NOT forcing search, and we have no other persistent selection, we Auto-Select this.

            if (!options?.ignoreCache) {
                // Check persistent selection
                const cachedEntry = cache[persistenceKey];
                if (!cachedEntry || !cachedEntry.selectedId) {
                    // No user override -> Use Embedded
                    this.lastResults = [embeddedResult];
                    return this.selectLyric(0, false);
                }
            }

            // If we fall through, we will search, but we want this embedded result in the list.
            // We'll add it to 'results' after search completions or prepend it.
        }

        // 1.5 Check for Local File Content (Priority 0 - Highest)
        if (options?.localFileContent) {
            Logger.info(`[LyricsManager] Found local lyric file content`);
            const localResult: import("../interfaces/LyricResult").LyricResult = {
                id: "local_" + Date.now(),
                lyricText: options.localFileContent,
                source: "Local File",
                score: 101, // Higher than embedded (100)
                title: song.title,
                artist: song.artists.join(", "),
                duration: song.duration
            };

            // If we are just ignoring cache (manual search), add to list.
            // If normal load, this is usually the best candidate.

            if (!options?.ignoreCache) {
                // Check persistent selection
                const cachedEntry = cache[persistenceKey];
                if (!cachedEntry || !cachedEntry.selectedId) {
                    // No user override -> Use Local File
                    this.lastResults.unshift(localResult);
                    // We need to ensure we don't double add if we continue... 
                    // Actually, let's just add it to 'lastResults' here and return selectLyric(0).
                    // But wait, what if we also have embedded lyrics? We want them in the list too.
                    // And online candidates?

                    // If we have local file, we usually DON'T search online automatically unless requested?
                    // But the user might want to switch TO online.
                    // So we should probably continue to search (or use cache) to populate the list, 
                    // but select the local file by default.

                    // Let's add it to a "pending" list or just remember it.
                }
            }
            // For now, let's push it to a temp array or just modify flow. 
            // Simplest: Add to beginning of final results.
        }

        if (!options?.ignoreCache) {
            const cachedEntry = cache[persistenceKey];
            if (cachedEntry && cachedEntry.selectedId) {
                // We have a specific saved choice for this FILE.
                Logger.info(`[LyricsManager] Found persistent entry for ${persistenceKey}`);

                // IMPORTANT: Always ensure embedded lyrics are in the list!
                let restoredResults = [...cachedEntry.results];

                // Check if embedded lyrics already in the list
                const hasEmbedded = restoredResults.some(r => r.source === "Embedded (ID3)");

                if (song.lyrics && !hasEmbedded) {
                    Logger.info(`[LyricsManager] Prepending embedded lyrics to cached results`);
                    const embeddedResult: import("../interfaces/LyricResult").LyricResult = {
                        id: "embedded_" + song.persistenceId,
                        lyricText: song.lyrics,
                        source: "Embedded (ID3)",
                        score: 100,
                        title: song.title,
                        artist: song.artists.join(", "),
                        duration: song.duration
                    };
                    restoredResults.unshift(embeddedResult);
                }

                // Check and add local file if provided
                const hasLocal = restoredResults.some(r => r.source === "Local File");
                if (options?.localFileContent && !hasLocal) {
                    const localResult: import("../interfaces/LyricResult").LyricResult = {
                        id: "local_" + song.persistenceId,
                        lyricText: options.localFileContent,
                        source: "Local File",
                        score: 101,
                        title: song.title,
                        artist: song.artists.join(", "),
                        duration: song.duration
                    };
                    restoredResults.unshift(localResult);
                }

                this.lastResults = restoredResults;

                const idx = this.lastResults.findIndex(r => r.id === cachedEntry.selectedId);
                if (idx !== -1) {
                    Logger.info(`[LyricsManager] Restoring selected lyric: ${cachedEntry.selectedId}`);
                    return this.selectLyric(idx, false);
                }
            }
        }

        // 2. If no selection or ignoring cache, we SEARCH.
        // Check SEARCH cache (deduplication for queries)
        // If ignoreCache is true, we skip this too.
        if (!options?.ignoreCache) {
            const cachedSearch = cache[searchKey];
            // Note: 'cache' is a flat map currently. keys are mixed.
            if (cachedSearch) {
                Logger.info(`[LyricsManager] Found cached search results for query ${searchKey}`);
                this.lastResults = cachedSearch.results;
                if (this.lastResults.length > 0) {
                    // Since this is a "Fresh" load (not restoring selection), default to 0?
                    // Or just return keys?
                    // If we are just searching (no persistence yet), we pick 0.
                    return this.selectLyric(0, false);
                }
                return false;
            }
        }

        // 3. Perform Actual Search
        const results = await this.searcher.search(song, limit, (incrementalResults) => {
            Logger.info(`[LyricsManager] Received incremental results: ${incrementalResults.length}`);

            // Merge into current results if we are still active on this song
            if (this.currentSongKey !== persistenceKey) return;

            // We need to merge incrementalResults into this.lastResults
            // Deduplicate by ID?
            const existingIds = new Set(this.lastResults.map(r => r.id));
            const newOnes = incrementalResults.filter(r => !existingIds.has(r.id));

            if (newOnes.length > 0) {
                this.lastResults = [...this.lastResults, ...newOnes];
                // Sort again
                this.lastResults.sort((a, b) => b.score - a.score);

                // Look for best candidate currently
                // If we haven't selected anything yet (currentLyrics is null or placeholder?), or if we want to AUTO-SWITCH to a better one?
                // Requirement: "Select highest score candidate in real time"

                // We should probably only auto-switch if the new best score is significantly better 
                // OR if we are currently using a "low quality" lyric.
                // For now, let's aggressively select the best one if it's better than current.

                const best = this.lastResults[0];
                const currentScore = Number(this.currentLyrics?.metadata?.score || 0);
                if (best && best.score > currentScore) {
                    Logger.info(`[LyricsManager] Auto-selecting better candidate from stream: ${best.title} (${best.score})`);
                    // We need to find the index in the new sorted array
                    const idx = this.lastResults.indexOf(best);
                    this.selectLyric(idx, true);
                }
            }
        });
        if (song.lyrics) {
            const embeddedResult: import("../interfaces/LyricResult").LyricResult = {
                id: "embedded_" + Date.now(),
                lyricText: song.lyrics,
                source: "Embedded (ID3)",
                score: 100,
                title: song.title,
                artist: song.artists.join(", "),
                duration: song.duration
            };
            results.unshift(embeddedResult);
        }

        if (options?.localFileContent) {
            const localResult: import("../interfaces/LyricResult").LyricResult = {
                id: "local_" + Date.now(),
                lyricText: options.localFileContent,
                source: "Local File",
                score: 101,
                title: song.title,
                artist: song.artists.join(", "),
                duration: song.duration
            };
            results.unshift(localResult);
        }

        this.lastResults = results;

        Logger.info(`[LyricsManager] Search returned ${results.length} candidates.`);

        if (results.length > 0) {
            // Cache the SEARCH RESULTS separately by Query 
            this.saveCache(searchKey, results, null);

            // If this was an AUTO-MATCH (no ignoreCache), we might want to also save to PersistenceKey?
            // Only if persistenceKey matches searchKey? No.
            // If this is the first time we load a file, we auto-save the default choice.
            // BUT, if we are doing Manual Search (ignoreCache=true), we DO NOT save to PersistenceKey yet.
            // We only save to PersistenceKey when 'selectLyric' is called by the UI.

            // Always update persistence with the new search results and default selection
            this.saveCache(persistenceKey, results, results[0].id || null);
            return this.selectLyric(0, false);
        }

        return false;
    }

    public selectLyric(index: number, saveSelection: boolean = true): boolean {
        if (index < 0 || index >= this.lastResults.length) return false;

        const best = this.lastResults[index];
        Logger.info(`[LyricsManager] Selected Index ${index}: ${best.title} (Score: ${best.score})`);

        const data = this.parse(best.lyricText);
        if (!data.metadata) {
            data.metadata = {};
        }
        data.metadata['source'] = best.source;
        data.metadata['score'] = String(best.score); // Store score for comparison
        data.metadata['title'] = data.metadata['title'] || best.title || ""; // update meta
        data.metadata['artist'] = data.metadata['artist'] || best.artist || "";
        this.currentLyrics = data;

        if (saveSelection && this.currentSongKey && best.id) {
            this.saveCache(this.currentSongKey, this.lastResults, best.id);
        }

        return true;
    }

    public markResultAsIncorrect() {
        if (this.currentSongKey) {
            // Just plain save with null selection
            this.saveCache(this.currentSongKey, this.lastResults, null);
        }
    }

    private loadCache(): Record<string, { results: any[], selectedId: string | null }> {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    private saveCache(key: string, results: any[], selectedId: string | null) {
        try {
            const cache = this.loadCache();
            cache[key] = { results, selectedId };
            // Simple LRU or limit? For now just unbound.
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.error("Failed to save lyric cache", e);
        }
    }

    public getLastSearchResults(): import("../interfaces/LyricResult").LyricResult[] {
        return this.lastResults;
    }

    /**
     * Retrieves the CHOSEN lyric result from the persistence cache for a given song, if available.
     * Does not update internal state (currentLyrics, etc.).
     */
    public getLyricFromCache(song: SongInformation): import("../interfaces/LyricResult").LyricResult | null {
        try {
            const persistenceKey = song.persistenceId ? song.persistenceId : `${song.title}|${song.artists.join(',')}`;
            const cache = this.loadCache();
            const cachedEntry = cache[persistenceKey];

            if (cachedEntry && cachedEntry.results && cachedEntry.selectedId) {
                // Find the selected result
                const selected = cachedEntry.results.find((r: any) => r.id === cachedEntry.selectedId);
                return selected || null;
            }
        } catch (e) {
            console.error("Error reading cache", e);
        }
        return null;
    }
}
