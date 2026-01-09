import { describe, it, expect } from 'vitest';
import { StandardLrcParser } from './StandardLrcParser';
import { EnhancedLrcParser } from './EnhancedLrcParser';

describe('StandardLrcParser', () => {
    const parser = new StandardLrcParser();

    it('should parse simple lyrics', () => {
        const lrc = `[00:01.00]Hello World
[00:02.50]Bye World`;
        const data = parser.parse(lrc);

        expect(data.lines).toHaveLength(2);
        expect(data.lines[0].startTime).toBe(1000);
        expect(data.lines[0].text).toBe('Hello World');
        expect(data.lines[1].startTime).toBe(2500);
    });

    it('should handle metadata', () => {
        const lrc = `[ti:Test Song]
[ar:Tester]
[00:01.00]Line 1`;
        const data = parser.parse(lrc);

        expect(data.metadata['ti']).toBe('Test Song');
        expect(data.metadata['ar']).toBe('Tester');
        expect(data.lines).toHaveLength(1);
    });

    it('should handle duplicate timestamps as layers', () => {
        const lrc = `[00:01.00]Original
[00:01.00]Translation`;
        const data = parser.parse(lrc);

        expect(data.lines).toHaveLength(2);
        expect(data.lines[0].layer).toBe(0);
        expect(data.lines[1].layer).toBe(1);
        expect(data.lines[0].text).toBe('Original');
        expect(data.lines[1].text).toBe('Translation');
    });
});

describe('EnhancedLrcParser', () => {
    const parser = new EnhancedLrcParser();

    it('should parse word-level timestamps', () => {
        // Format: [line_start] <word_start>Word<next_word_start>
        const lrc = `[00:01.00]<00:01.00>He<00:01.50>llo`;
        const data = parser.parse(lrc);

        expect(data.lines).toHaveLength(1);
        const line = data.lines[0];

        expect(line.text).toBe('Hello'); // Cleaned text
        expect(line.syllables).toBeDefined();
        expect(line.syllables).toHaveLength(2);

        // Check first syllable "He"
        // Line start: 1000ms. Syllable start: 1000ms. Relative: 0.
        expect(line.syllables![0].text).toBe('He');
        expect(line.syllables![0].startTime).toBe(0);
        expect(line.syllables![0].duration).toBe(500); // 1.50 - 1.00 = 0.5s = 500ms

        // Check second syllable "llo"
        expect(line.syllables![1].text).toBe('llo');
        expect(line.syllables![1].startTime).toBe(500);
    });
});
