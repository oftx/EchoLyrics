/**
 * Computes Levenshtein Distance between two strings.
 * Used for fuzzy matching titles and artists.
 */
export function levenshteinDistance(s: string, t: string): number {
    const n = s.length;
    const m = t.length;

    if (n === 0) return m;
    if (m === 0) return n;

    // Create matrix
    const d: number[][] = [];
    for (let i = 0; i <= n; i++) d[i] = [i];
    for (let j = 0; j <= m; j++) d[0][j] = j;

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = (t[j - 1] === s[i - 1]) ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,     // deletion
                d[i][j - 1] + 1,     // insertion
                d[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return d[n][m];
}

/**
 * Calculates similarity ratio (0.0 to 1.0).
 * 1.0 = exact match.
 */
export function calculateSimilarity(s: string, t: string): number {
    // Normalize unicode (decompose accents) and remove diacritic marks
    const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const sNorm = normalize(s);
    const tNorm = normalize(t);

    const maxLen = Math.max(sNorm.length, tNorm.length);
    if (maxLen === 0) return 1.0;

    const dist = levenshteinDistance(sNorm, tNorm);
    return 1.0 - (dist / maxLen);
}
