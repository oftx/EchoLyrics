import { describe, it, expect } from 'vitest';
import { PlaybackSynchronizer } from './PlaybackSynchronizer';
import { LyricsData } from '../models/LyricsData';

describe('PlaybackSynchronizer', () => {
    const sync = new PlaybackSynchronizer();
    const mockLyrics: LyricsData = {
        lines: [
            { startTime: 1000, text: "Line 1", layer: 0 },
            { startTime: 2000, text: "Line 2", layer: 0 },
            { startTime: 3000, text: "Line 3", layer: 0 }
        ],
        metadata: {}
    };

    it('should find correct line using binary search', () => {
        // Before first line
        expect(sync.findLineIndex(mockLyrics, 0)).toBe(-1);
        expect(sync.findLineIndex(mockLyrics, 999)).toBe(-1);

        // Exact match
        expect(sync.findLineIndex(mockLyrics, 1000)).toBe(0);

        // Between lines
        expect(sync.findLineIndex(mockLyrics, 1500)).toBe(0);
        expect(sync.findLineIndex(mockLyrics, 2999)).toBe(1);

        // Last line and beyond
        expect(sync.findLineIndex(mockLyrics, 3000)).toBe(2);
        expect(sync.findLineIndex(mockLyrics, 5000)).toBe(2);
    });

    it('should calculate progress', () => {
        const line1 = mockLyrics.lines[0]; // starts 1000
        const line2 = mockLyrics.lines[1]; // starts 2000

        // At start: 1000ms. Progress 0.
        expect(sync.calculateLineProgress(line1, line2, 1000)).toBe(0);

        // At mid: 1500ms. Duration 1000ms. Progress 0.5.
        expect(sync.calculateLineProgress(line1, line2, 1500)).toBe(0.5);

        // At end: 2000ms. Progress 1.
        expect(sync.calculateLineProgress(line1, line2, 2000)).toBe(1);
    });
});
