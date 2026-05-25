/**
 * Jaccard similarity over the FULL feature sets — used for the final score,
 * not the LSH shortlist. LSH's MinHash estimate is approximate by design;
 * the score the dashboard exposes must be exact.
 */

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    if (a.size === 0 && b.size === 0) return 0
    let intersection = 0
    const [small, large] = a.size <= b.size ? [a, b] : [b, a]
    for (const value of small) if (large.has(value)) intersection += 1
    const union = a.size + b.size - intersection
    return union === 0 ? 0 : intersection / union
}
