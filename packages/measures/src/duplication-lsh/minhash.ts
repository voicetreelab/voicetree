/**
 * Deterministic MinHash signature for a set of string features.
 *
 * Uses N independent linear hash permutations (a*h + b) mod prime over a
 * stable FNV-1a-32 string hash, then takes the per-permutation minimum.
 * Two signatures' average per-row equality estimates their Jaccard
 * similarity (Broder 1997).
 */

const FNV_OFFSET: number = 0x811c9dc5
const FNV_PRIME: number = 0x01000193
// Largest 32-bit Mersenne prime; bigger than the FNV-1a output range so the
// (a*h + b) % p permutation is well-distributed across the hash space.
const PERM_PRIME: bigint = 2147483647n

function fnv1a32(input: string): number {
    let hash = FNV_OFFSET >>> 0
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, FNV_PRIME) >>> 0
    }
    return hash >>> 0
}

type Permutation = {readonly a: bigint; readonly b: bigint}

function permutationsFor(seed: number, count: number): Permutation[] {
    const result: Permutation[] = []
    for (let index = 0; index < count; index += 1) {
        // Re-seed each (a, b) pair off a single stable string so the
        // permutations are reproducible across processes and machines.
        const a = BigInt(fnv1a32(`mh-a-${seed}-${index}`))
        const b = BigInt(fnv1a32(`mh-b-${seed}-${index}`))
        // a must be non-zero mod prime; FNV outputs are non-zero in practice
        // but guard explicitly.
        result.push({a: a === 0n ? 1n : a, b})
    }
    return result
}

const PERM_CACHE: Map<string, Permutation[]> = new Map()

function getPermutations(seed: number, count: number): Permutation[] {
    const key = `${seed}:${count}`
    const cached = PERM_CACHE.get(key)
    if (cached) return cached
    const permutations = permutationsFor(seed, count)
    PERM_CACHE.set(key, permutations)
    return permutations
}

/**
 * Compute a MinHash signature for `features`.
 *
 * `permutationCount` controls accuracy/cost — 128 is the standard for
 * code-similarity LSH (band x rows = 32 x 4 yields ~0.6 similarity threshold).
 * `seed` is mixed into the permutation derivation so different signal types
 * can share the implementation without bucket collisions.
 */
export function minhash(
    features: Iterable<string>,
    permutationCount: number,
    seed: number = 0,
): readonly number[] {
    const permutations = getPermutations(seed, permutationCount)
    const signature: number[] = new Array(permutationCount).fill(Number.MAX_SAFE_INTEGER)

    let sawAny = false
    for (const feature of features) {
        sawAny = true
        const hash = BigInt(fnv1a32(feature))
        for (let index = 0; index < permutationCount; index += 1) {
            const {a, b} = permutations[index]
            const permuted = Number(((a * hash + b) % PERM_PRIME))
            if (permuted < signature[index]) signature[index] = permuted
        }
    }

    // Empty inputs produce a sentinel signature that won't collide with
    // any real signature in LSH.
    if (!sawAny) return new Array(permutationCount).fill(-1)
    return signature
}

/** Exposed because the structural fingerprint also wants a stable string hash. */
export function stableHash(input: string): number {
    return fnv1a32(input)
}
