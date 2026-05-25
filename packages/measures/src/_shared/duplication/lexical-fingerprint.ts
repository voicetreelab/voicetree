/**
 * Lexical fingerprint (Type-3 clone detector).
 *
 * Slides a 5-token window across the function's normalized token stream and
 * produces the multiset of resulting shingles. The MinHash signature of the
 * shingle set goes into LSH (32 bands x 4 rows). The full shingle set is
 * kept for the exact Jaccard score the dashboard reports.
 */
import {minhash} from './minhash'

export const LEX_SHINGLE_SIZE: number = 5
export const LEX_PERMUTATION_COUNT: number = 128
export const LEX_BAND_COUNT: number = 32
export const LEX_ROWS_PER_BAND: number = 4
const LEX_SEED: number = 1

export type LexicalFingerprint = {
    readonly shingles: ReadonlySet<string>
    readonly signature: readonly number[]
}

function shinglesOf(tokens: readonly string[], size: number): Set<string> {
    const shingles = new Set<string>()
    if (tokens.length < size) {
        // Short streams still need *some* feature so the signature differs
        // from the empty sentinel — emit the whole stream as one shingle.
        if (tokens.length > 0) shingles.add(tokens.join('|'))
        return shingles
    }
    for (let start = 0; start <= tokens.length - size; start += 1) {
        shingles.add(tokens.slice(start, start + size).join('|'))
    }
    return shingles
}

export function lexicalFingerprint(tokens: readonly string[]): LexicalFingerprint {
    const shingles = shinglesOf(tokens, LEX_SHINGLE_SIZE)
    const signature = minhash(shingles, LEX_PERMUTATION_COUNT, LEX_SEED)
    return {shingles, signature}
}
