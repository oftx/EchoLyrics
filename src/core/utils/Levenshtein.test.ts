import { describe, it, expect } from 'vitest';
import { calculateSimilarity } from './Levenshtein';

describe('Levenshtein Similarity', () => {
    it('should match exact strings', () => {
        expect(calculateSimilarity("hello", "hello")).toBe(1.0);
    });

    it('should ignore case', () => {
        expect(calculateSimilarity("Hello", "hello")).toBe(1.0);
    });

    it('should ignore accents (normalization)', () => {
        // Beyonce vs Beyoncé
        // Previous logic: dist=1, len=7 -> 0.85
        // New logic: normalize("Beyoncé") -> "beyonce", dist=0 -> 1.0
        expect(calculateSimilarity("Beyonce", "Beyoncé")).toBe(1.0);

        expect(calculateSimilarity("Fiancé", "Fiance")).toBe(1.0);
        expect(calculateSimilarity("Mötley Crüe", "Motley Crue")).toBe(1.0);
    });

    it('should handle partial mismatches', () => {
        const sim = calculateSimilarity("test", "tent");
        // dist=1, len=4 -> 0.75
        expect(sim).toBe(0.75);
    });
});
