/**
 * Deterministic MinHash signature for a set of string features.
 *
 * Uses N independent linear hash permutations (a*h + b) mod prime over a
 * stable FNV-1a-32 string hash, then takes the per-permutation minimum.
 * Two signatures' average per-row equality estimates their Jaccard
 * similarity (Broder 1997).
 *
 * The permutation arithmetic is done in IEEE-754 doubles, not BigInt: with a
 * Mersenne modulus of 2^31-1 every intermediate stays below 2^48, well inside
 * the 2^53 exact-integer range of a double (see `mulModPrime`). This is
 * bit-identical to the BigInt formulation but avoids per-feature BigInt
 * allocation in the hot inner loop.
 */

const FNV_OFFSET: number = 0x811c9dc5
const FNV_PRIME: number = 0x01000193
// Largest 32-bit Mersenne prime; bigger than the FNV-1a output range so the
// (a*h + b) % p permutation is well-distributed across the hash space.
const PERM_PRIME: number = 2147483647

function fnv1a32(input: string): number {
    let hash = FNV_OFFSET >>> 0
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, FNV_PRIME) >>> 0
    }
    return hash >>> 0
}

/**
 * (factor * value) mod PERM_PRIME, computed in exact double arithmetic.
 *
 * Both inputs are already reduced into [0, PERM_PRIME) < 2^31. Splitting
 * `value` into 16-bit halves keeps every product below 2^31 * 2^16 = 2^47,
 * and their sum below 2^48 — all exactly representable as doubles, so the
 * result is identical to the BigInt expression `(factor * value) % p`.
 */
function mulModPrime(factor: number, hi: number, lo: number): number {
    return (((factor * hi) % PERM_PRIME) * 65536 + factor * lo) % PERM_PRIME
}

/**
 * A set of permutations as struct-of-arrays: `a[i]` and `b[i]` are the linear
 * coefficients of permutation `i`, pre-reduced into [0, PERM_PRIME). Flat
 * typed arrays keep the per-permutation inner loop monomorphic and
 * allocation-free.
 */
type PermutationSet = {readonly a: Float64Array; readonly b: Float64Array}

function permutationsFor(seed: number, count: number): PermutationSet {
    const a = new Float64Array(count)
    const b = new Float64Array(count)
    for (let index = 0; index < count; index += 1) {
        // Re-seed each (a, b) pair off a single stable string so the
        // permutations are reproducible across processes and machines.
        const rawA = fnv1a32(`mh-a-${seed}-${index}`)
        // a must be non-zero mod prime; FNV outputs are non-zero in practice
        // but guard explicitly. Reduce mod prime up front so the inner loop
        // only ever multiplies values already inside [0, PERM_PRIME).
        a[index] = (rawA === 0 ? 1 : rawA) % PERM_PRIME
        b[index] = fnv1a32(`mh-b-${seed}-${index}`) % PERM_PRIME
    }
    return {a, b}
}

const PERM_CACHE: Map<string, PermutationSet> = new Map()

function getPermutations(seed: number, count: number): PermutationSet {
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
    const {a: permA, b: permB} = getPermutations(seed, permutationCount)
    const signature: number[] = new Array(permutationCount).fill(Number.MAX_SAFE_INTEGER)

    let sawAny = false
    for (const feature of features) {
        sawAny = true
        const hash = fnv1a32(feature) % PERM_PRIME
        // Pre-split the (per-feature) hash once; the inner loop reuses it
        // across every permutation.
        const hi = Math.floor(hash / 65536)
        const lo = hash % 65536
        for (let index = 0; index < permutationCount; index += 1) {
            const permuted = (mulModPrime(permA[index], hi, lo) + permB[index]) % PERM_PRIME
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
