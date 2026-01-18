import { Logger } from "../utils/Logger";
import { LyricsSearcherService } from "./LyricsSearcherService";
import { PlaybackSynchronizer } from "./PlaybackSynchronizer";
import { LyricsParser } from "../interfaces/LyricsParser";
import { StandardLrcParser } from "../parsers/StandardLrcParser";
import { EnhancedLrcParser } from "../parsers/EnhancedLrcParser";
import { LyricsData } from "../models/LyricsData";
import { SongInformation } from "../interfaces/SongInformation";

import { QrcParser } from "../parsers/QrcParser";
import { LyricTypeDetector } from "../utils/LyricTypeDetector";
import { LyricResult } from "../interfaces/LyricResult";

export enum DisplayMode {
    Original = "Original",
    Translation = "Translation",
    Both = "Both"
}

/**
 * Main facade for the UI to interact with.
 * Manages search, parsing, and state.
 */
export class LyricsManager {
    private searcher = new LyricsSearcherService();
    private synchronizer = new PlaybackSynchronizer();
    private parsers: LyricsParser[] = [
        new QrcParser(),      // Check for specialized QRC first
        new EnhancedLrcParser(),
        new StandardLrcParser()
    ];

    private currentLyrics: LyricsData | null = null;
    private lastResults: LyricResult[] = [];
    private currentSongKey: string = "";
    private listeners: ((data: LyricsData | null) => void)[] = [];

    private readonly STORAGE_KEY = "echo_lyrics_cache_v1";

    constructor() {
        // Init default parsers? yes.
        const savedMode = localStorage.getItem("lyrics_display_mode");
        if (savedMode && Object.values(DisplayMode).includes(savedMode as any)) {
            this.displayMode = savedMode as DisplayMode;
        } else {
            this.displayMode = DisplayMode.Both; // Default to Both
        }
    }

    public subscribe(callback: (data: LyricsData | null) => void): () => void {
        this.listeners.push(callback);
        // Immediately notify current state? Maybe not strictly necessary but helpful
        // callback(this.currentLyrics); 
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l(this.currentLyrics));
    }

    public getSearcher(): LyricsSearcherService {
        return this.searcher;
    }

    public getProviders(): import("../interfaces/LyricsProvider").LyricsProvider[] {
        return this.searcher.getProviders();
    }

    public getSynchronizer(): PlaybackSynchronizer {
        return this.synchronizer;
    }

    /**
     * Parses the given text using available parsers.
     * @param text Raw lyrics text.
     */
    public parse(text: string): LyricsData {
        let bestData: LyricsData | null = null;

        for (const parser of this.parsers) {
            try {
                const data = parser.parse(text);
                if (data.isSynced && data.lines.length > 0) {
                    bestData = data;
                    break;
                }
                // Keep the result even if not synced if it's the only one
                if (!bestData) bestData = data;
            } catch (e) {
                Logger.warn("Parser failed", e);
            }
        }

        // If all failed or no synced found, use the last valid one or empty
        const finalData = bestData || { lines: [], metadata: {}, isSynced: false };

        this.currentLyrics = finalData;
        this.notifyListeners();
        return finalData;
    }

    public getCurrentLyrics(): LyricsData | null {
        return this.currentLyrics;
    }

    /**
     * Sorts candidates with custom logic:
     * - Absolute score difference > 20: Higher score wins.
     * - Score difference <= 20: Prefer Karaoke (QRC/Enhanced) over Standard.
     */
    private sortCandidates(candidates: LyricResult[]): LyricResult[] {
        return candidates.sort((a, b) => {
            const scoreDiff = b.score - a.score;

            // If scores are significantly different, just trust the score
            if (Math.abs(scoreDiff) > 20) {
                return scoreDiff;
            }

            // Scores are close (within 20 points), check for Karaoke types
            // We use the same detection logic as the UI
            // Note: passing translationText is important for full detection
            const typeA = LyricTypeDetector.getLyricTypes(a.lyricText, a.translationText);
            const typeB = LyricTypeDetector.getLyricTypes(b.lyricText, b.translationText);

            // Priority: Karaoke > Standard
            if (typeA.hasKaraoke && !typeB.hasKaraoke) return -1; // A comes first
            if (!typeA.hasKaraoke && typeB.hasKaraoke) return 1;  // B comes first

            // Fallback to raw score for tie-breaking within same type
            return scoreDiff;
        });
    }

    /**
     * High level method to load lyrics for a song.
     * @param song Song Metadata
     * @param options.ignoreCache If true, bypasses the search cache (forces new search).
     * @param options.limit Max results.
     */
    public async loadLyricsForSong(song: SongInformation, options?: { ignoreCache?: boolean, limit?: number, localFileContent?: string, onProgress?: (msg: string) => void }): Promise<boolean> {
        this.lastResults = []; // Clear previous
        this.currentLyrics = null; // Reset current lyrics state for new song
        this.notifyListeners(); // Notify UI to clear

        const limit = options?.limit || 15;
        const onProgress = options?.onProgress;

        if (onProgress) onProgress("Checking cache...");

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
            const embeddedResult: LyricResult = {
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
                    if (onProgress) onProgress("Using embedded lyrics.");
                    return this.selectLyric(0, false);
                }
            }

            // If we fall through, we will search, but we want this embedded result in the list.
            // We'll add it to 'results' after search completions or prepend it.
        }

        // 1.5 Check for Local File Content (Priority 0 - Highest)
        if (options?.localFileContent) {
            Logger.info(`[LyricsManager] Found local lyric file content`);
            const localResult: LyricResult = {
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
                    // Actually, let's just add it to 'lastResults' and return selectLyric(0).
                    // But wait, what if we also have embedded lyrics? We want them in the list too.
                    // And online candidates?

                    // If we have local file, we usually DON'T search online automatically unless requested?
                    // But the user might want to switch TO online.
                    // So we should probably continue to search (or use cache) to populate the list, 
                    // but select the local file by default.

                    // Let's add it to a "pending" list or just remember it.
                    if (onProgress) onProgress("Using local lyrics file.");
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
                    const embeddedResult: LyricResult = {
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
                    const localResult: LyricResult = {
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
                    if (onProgress) onProgress("Restoring saved selection...");
                    return this.selectLyric(idx, false);
                }
            } else if (cachedEntry && cachedEntry.selectedId === "NO_LYRIC") {
                Logger.info(`[LyricsManager] Found persistent 'NO_LYRIC' choice for ${persistenceKey}. Aborting.`);
                // Return an empty object BUT with metadata so the UI knows we have "something" (a decision)
                // and keeps the "Switch Lyrics" button visible.
                this.currentLyrics = {
                    lines: [],
                    isSynced: false,
                    metadata: {
                        title: song.title,
                        artist: song.artists.join(", "),
                        source: "No Lyrics Selected"
                    }
                };
                this.notifyListeners();
                if (onProgress) onProgress("Restoring saved selection (No Lyrics).");
                return true;
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
                    if (onProgress) onProgress("Results found in cache.");
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
                // Sort again using custom logic
                this.lastResults = this.sortCandidates(this.lastResults);

                const best = this.lastResults[0];
                const currentScore = Number(this.currentLyrics?.metadata?.score || 0);

                // Rule 1: If we already have a "Good Enough" result (>=70), do not switch anymore.
                // This prevents jankiness once we have a solid match.
                if (currentScore >= 70) {
                    return;
                }

                // Rule 2: Only auto-select if the new result is "Acceptable" (> 45) AND better than what we have.
                if (best && best.score > 45 && best.score > currentScore) {
                    Logger.info(`[LyricsManager] Auto-selecting better candidate from stream: ${best.title} (${best.score})`);

                    if (onProgress) onProgress(`Found better match: ${best.source}`);

                    // We need to find the index in the new sorted array
                    const idx = this.lastResults.indexOf(best);
                    this.selectLyric(idx, true);
                }
            }
        }, onProgress);

        // 3.5 Check for Race Condition
        if (this.currentSongKey !== persistenceKey) {
            Logger.info(`[LyricsManager] Search result ignored because song changed (Current: ${this.currentSongKey}, Search: ${persistenceKey})`);
            return false;
        }

        if (song.lyrics) {
            const embeddedResult: LyricResult = {
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
            const localResult: LyricResult = {
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

        this.lastResults = this.sortCandidates(results);

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

    private displayMode: DisplayMode = DisplayMode.Original;

    public setDisplayMode(mode: DisplayMode) {
        this.displayMode = mode;
        localStorage.setItem("lyrics_display_mode", mode);
        // We don't need to re-parse, just notify listeners so UI updates
        this.notifyListeners();
    }

    public getDisplayMode(): DisplayMode {
        return this.displayMode;
    }

    public selectLyric(index: number, saveSelection: boolean = true): boolean {
        if (index < 0 || index >= this.lastResults.length) return false;

        const best = this.lastResults[index];
        Logger.info(`[LyricsManager] Selected Index ${index}: ${best.title} (Score: ${best.score})`);

        // Merge Original and Translation if available
        let rawText = best.lyricText;
        if (best.translationText) {
            Logger.info(`[LyricsManager] Merging translation for ${best.title}`);
            // Simple concatenation works because the parser sorts by timestamp
            // and groups identical timestamps into layers.
            rawText = rawText + "\n" + best.translationText;
        }

        const data = this.parse(rawText);
        if (!data.metadata) {
            data.metadata = {};
        }
        data.metadata['source'] = best.source;
        data.metadata['score'] = String(best.score); // Store score for comparison
        data.metadata['title'] = data.metadata['title'] || best.title || ""; // update meta
        data.metadata['artist'] = data.metadata['artist'] || best.artist || "";
        this.currentLyrics = data;
        this.notifyListeners();

        if (saveSelection && this.currentSongKey && best.id) {
            this.saveCache(this.currentSongKey, this.lastResults, best.id);
        }

        return true;
    }

    public selectNone() {
        Logger.info("[LyricsManager] User selected 'No Lyrics'. Clearing and persisting.");

        // Use a valid object so UI knows we have handled it
        this.currentLyrics = {
            lines: [],
            isSynced: false,
            metadata: {
                source: "No Lyrics Selected"
            }
        };
        this.notifyListeners();

        if (this.currentSongKey) {
            // Save special marker "NO_LYRIC"
            this.saveCache(this.currentSongKey, this.lastResults, "NO_LYRIC");
        }
    }

    public markResultAsIncorrect() {
        if (this.currentSongKey) {
            // Just plain save with null selection
            this.saveCache(this.currentSongKey, this.lastResults, null);
        }
    }

    private loadCache(): Record<string, { results: any[], selectedId: string | null, lastAccessed?: number }> {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    private saveCache(key: string, results: any[], selectedId: string | null) {
        // Optimize: Only save the top N results to save space
        // Always keep the selected one if it exists
        let resultsToSave = results;
        if (results.length > 5) {
            if (selectedId) {
                const selected = results.find(r => r.id === selectedId);
                const others = results.filter(r => r.id !== selectedId).slice(0, 4);
                resultsToSave = selected ? [selected, ...others] : results.slice(0, 5);
            } else {
                resultsToSave = results.slice(0, 5);
            }
        }

        const entry = {
            results: resultsToSave,
            selectedId,
            lastAccessed: Date.now()
        };

        const maxRetries = 5;
        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                const cache = this.loadCache();
                cache[key] = entry;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cache));
                if (attempts > 0) {
                    Logger.info(`[LyricsManager] Cache saved after ${attempts} pruning attempts.`);
                }
                return; // Success
            } catch (e: any) {
                if (e.name === 'QuotaExceededError' || e.code === 22 || e.number === -2147024882) {
                    attempts++;
                    Logger.warn(`[LyricsManager] Storage quota exceeded. Pruning attempt ${attempts}...`);

                    if (!this.pruneCache()) {
                        Logger.error("[LyricsManager] Could not prune enough space to save cache.");
                        break; // Stop if pruning fails/returns false (no more space to free)
                    }
                } else {
                    console.error("Failed to save lyric cache", e);
                    break;
                }
            }
        }
    }

    /**
     * Removes old entries to free up space.
     * Returns true if anything was removed.
     * 
     * Strategy:
     * 1. First, try to remove UNUSED candidates (non-selected) from existing entries.
     * 2. If no unused candidates found, remove oldest Song entries.
     */
    private pruneCache(): boolean {
        try {
            const cache = this.loadCache();
            const keys = Object.keys(cache);
            if (keys.length === 0) return false;

            let spaceFreed = false;

            // STAGE 1: Minimalist Pruning (Remove unused candidates)
            // Iterate through all entries, if any entry has > 1 result, keep ONLY the selected one.
            for (const key of keys) {
                const entry = cache[key];
                if (entry && entry.results && entry.results.length > 1) {
                    const originalCount = entry.results.length;

                    if (entry.selectedId) {
                        const selected = entry.results.find((r: any) => r.id === entry.selectedId);
                        if (selected) {
                            entry.results = [selected];
                        } else {
                            // Selected ID not found? Just keep first.
                            entry.results = [entry.results[0]];
                        }
                    } else {
                        // No selection, just keep the first one
                        entry.results = [entry.results[0]];
                    }

                    if (entry.results.length < originalCount) {
                        spaceFreed = true;
                    }
                }
            }

            if (spaceFreed) {
                Logger.info("[LyricsManager] Pruned unused candidates from cache entries.");
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cache));
                return true;
            }

            // STAGE 2: Aggressive Pruning (Remove oldest entries)
            // If we are here, it means all entries are already minimal (1 result each).
            // We must delete entire song entries.

            // Sort by lastAccessed (oldest first)
            const entries = keys.map(k => ({
                key: k,
                lastAccessed: cache[k].lastAccessed || 0
            }));

            entries.sort((a, b) => a.lastAccessed - b.lastAccessed);

            // Remove oldest 20%
            const deleteCount = Math.max(1, Math.floor(entries.length * 0.2));
            const toDelete = entries.slice(0, deleteCount);

            toDelete.forEach(item => {
                delete cache[item.key];
            });

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cache));
            Logger.info(`[LyricsManager] Pruned ${deleteCount} oldest entries from cache.`);
            return true;
        } catch (e) {
            Logger.error("[LyricsManager] Error while pruning cache", e);
            return false;
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

            if (cachedEntry) {
                // Update access time (lazy update)
                // We don't save immediately to avoid write thrashing on every read, 
                // but strictly speaking we should. 
                // Let's rely on saveCache happening on selection or search updates.

                if (cachedEntry.results && cachedEntry.selectedId) {
                    const selected = cachedEntry.results.find((r: any) => r.id === cachedEntry.selectedId);
                    return selected || null;
                }
            }
        } catch (e) {
            console.error("Error reading cache", e);
        }
        return null;
    }
}
