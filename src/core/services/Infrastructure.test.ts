import { describe, it, expect } from 'vitest';
import { ScoringService } from './ScoringService';
import { LyricsSearcherService } from './LyricsSearcherService';
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
        // 40 + 30 + 20 - 10 = 80
        expect(score).toBe(80);
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
});
