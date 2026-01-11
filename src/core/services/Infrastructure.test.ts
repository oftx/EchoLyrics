import { describe, it, expect } from 'vitest';
import { ScoringService } from './ScoringService';
import { LyricsSearcherService } from './LyricsSearcherService';
import { LyricsManager } from './LyricsManager';
import { MockNetworkProvider } from '../providers/MockNetworkProvider';
import { SongInformation } from '../interfaces/SongInformation';
import { LyricResult } from '../interfaces/LyricResult';


describe('ScoringService', () => {
    const service = new ScoringService();
    const song: SongInformation = {
        title: "Test Song",
        artists: ["Test Artist"],
        album: "Test Album",
        duration: 200000,
        sourceId: "1"
    };

    it('should calculate perfect score', () => {
        const candidate: LyricResult = {
            lyricText: "",
            source: "test",
            score: 0,
            title: "Test Song",
            artist: "Test Artist",
            album: "Test Album",
            duration: 200000
        };
        const score = service.calculateScore(song, candidate);
        // 40 + 30 + 20 + 10 = 100
        expect(score).toBe(100);
    });

    it('should apply duration penalty', () => {
        const candidate: LyricResult = {
            lyricText: "",
            source: "test",
            score: 0,
            title: "Test Song",
            artist: "Test Artist",
            album: "Test Album",
            duration: 205000 // 5s diff
        };
        const score = service.calculateScore(song, candidate);
        // 40 + 30 + 20 + 4 (diff 5000ms) = 94
        expect(score).toBe(94);
    });
});

describe('LyricsSearcherService', () => {
    it('should aggregate results and sort', async () => {
        const searcher = new LyricsSearcherService();
        searcher.registerProvider(new MockNetworkProvider());

        const song: SongInformation = {
            title: "Hello",
            artists: ["Adele"],
            album: "25",
            duration: 180000,
            sourceId: "1"
        };

        const results = await searcher.search(song);
        expect(results).toBeDefined();
        // Since Mock returns match with title "Hello", it should get good score.
        // Mock doesn't return duration, so it might lose 10 points or get penalty?
        // Mock code I wrote: returns title "Hello", Artist "Adele", Album "25". Duration undefined.
        // Score: 40 + 30 + 20 = 90.
        // Duration check: candidate.duration is undefined -> logic skips (neither points nor penalty? OR penalty?)
        // My implementation: if (target.duration > 0 && candidate.duration...)
        // So undefined candidate.duration means 0 points from duration. Score 90.

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].score).toBe(90);
    });
    it('should stream results via callback', async () => {
        const searcher = new LyricsSearcherService();
        searcher.registerProvider(new MockNetworkProvider());

        const song: SongInformation = {
            title: "Hello",
            artists: ["Adele"],
            album: "25",
            duration: 180000,
            sourceId: "1"
        };

        const callbacks: number[] = [];
        const results = await searcher.search(song, 15, (res) => {
            callbacks.push(res.length);
        });

        expect(results.length).toBeGreaterThan(0);
        expect(callbacks.length).toBeGreaterThan(0);
        expect(callbacks[0]).toBeGreaterThan(0);
    });
});

describe('LyricsManager Auto-Selection', () => {
    it('should follow threshold rules', async () => {
        const manager = new LyricsManager();
        // Monkey patch searcher to simulate stream
        const searcher = manager.getSearcher();

        searcher.search = async (_song: SongInformation, _limit?: number, onResult?: (res: LyricResult[]) => void) => {
            // Stream 1: Low score
            if (onResult) {
                onResult([{
                    id: '1', title: 'Low', artist: 'Unknown', score: 40, source: 'test', lyricText: '', duration: 0
                }]);
                // Check manager state? We can't easily wait here without sleep or access.
                // But LyricsManager update is synchronous in the callback.
            }
            // Verify 1: Should NOT select (40 <= 45)
            expect(manager.getCurrentLyrics()).toBeNull();

            // Stream 2: Valid score
            if (onResult) {
                onResult([{
                    id: '2', title: 'OK', artist: 'Artist', score: 50, source: 'test', lyricText: 'OK', duration: 0
                }]);
            }
            // Verify 2: Should Select (50 > 45)
            expect(manager.getCurrentLyrics()?.metadata?.score).toBe("50");

            // Stream 3: Better score
            if (onResult) {
                onResult([{
                    id: '3', title: 'Better', artist: 'Artist', score: 60, source: 'test', lyricText: 'Better', duration: 0
                }]);
            }
            // Verify 3: Should Select (60 > 50)
            expect(manager.getCurrentLyrics()?.metadata?.score).toBe("60");

            // Stream 4: Lock Threshold
            if (onResult) {
                onResult([{
                    id: '4', title: 'Good', artist: 'Artist', score: 75, source: 'test', lyricText: 'Good', duration: 0
                }]);
            }
            // Verify 4: Should Select (75 >= 70)
            expect(manager.getCurrentLyrics()?.metadata?.score).toBe("75");

            // Stream 5: Even Higher Score (after Lock)
            if (onResult) {
                onResult([{
                    id: '5', title: 'Best', artist: 'Artist', score: 90, source: 'test', lyricText: 'Best', duration: 0
                }]);
            }
            // Verify 5: Should NOT Switch (Locked at 75)
            expect(manager.getCurrentLyrics()?.metadata?.score).toBe("75");

            return [];
        };

        const song: SongInformation = { title: "Test", artists: ["Test"], album: "Test", duration: 1000, sourceId: "1" };
        await manager.loadLyricsForSong(song, { ignoreCache: true });
    });
});
