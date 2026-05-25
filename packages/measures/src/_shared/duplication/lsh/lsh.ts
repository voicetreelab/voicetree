/**
 * Band-based LSH over MinHash signatures.
 *
 * Slice a signature into `bandCount` bands of `rowsPerBand` rows. Two
 * signatures that share at least one band collide into the same bucket and
 * therefore become a candidate pair. The standard 32 x 4 (=128 perms)
 * configuration approximates a similarity threshold of ~0.6.
 *
 * Signatures are an integer vector — we hash each band's slice into a
 * single string key for bucketing.
 */

export type SignedItem = {
    readonly id: string
    readonly signature: readonly number[]
}

export type LshOptions = {
    readonly bandCount: number
    readonly rowsPerBand: number
}

/**
 * Separator used inside pair keys. Function ids are of the form
 * `relativePath:line:name`; `||` is illegal in POSIX paths and not a valid
 * substring of TS identifiers, so it survives every realistic id.
 */
const PAIR_SEPARATOR: string = '||'

function bandKey(bandIndex: number, slice: readonly number[]): string {
    // Including bandIndex prevents accidental collisions between band N and
    // band M when their slices happen to match.
    return `${bandIndex}:${slice.join(',')}`
}

/**
 * Produce candidate pairs from a set of signed items.
 *
 * Returns each unordered pair at most once (a < b lexicographic on id).
 */
export function lshBuckets(items: readonly SignedItem[], options: LshOptions): Set<string> {
    const buckets: Map<string, string[]> = new Map()

    for (const item of items) {
        for (let bandIndex = 0; bandIndex < options.bandCount; bandIndex += 1) {
            const start = bandIndex * options.rowsPerBand
            const slice = item.signature.slice(start, start + options.rowsPerBand)
            const key = bandKey(bandIndex, slice)
            const bucket = buckets.get(key)
            if (bucket) bucket.push(item.id)
            else buckets.set(key, [item.id])
        }
    }

    const pairs: Set<string> = new Set()
    for (const ids of buckets.values()) {
        if (ids.length < 2) continue
        const unique = [...new Set(ids)].sort()
        for (let outer = 0; outer < unique.length; outer += 1) {
            for (let inner = outer + 1; inner < unique.length; inner += 1) {
                pairs.add(`${unique[outer]}${PAIR_SEPARATOR}${unique[inner]}`)
            }
        }
    }

    return pairs
}

/** Encode a pair into the canonical sorted form used by lshBuckets. */
export function pairKey(idA: string, idB: string): string {
    return idA < idB
        ? `${idA}${PAIR_SEPARATOR}${idB}`
        : `${idB}${PAIR_SEPARATOR}${idA}`
}

/** Decode a pair key produced by lshBuckets or pairKey. */
export function decodePairKey(key: string): readonly [string, string] {
    const sep = key.indexOf(PAIR_SEPARATOR)
    if (sep < 0) throw new Error(`malformed pair key: ${key}`)
    return [key.slice(0, sep), key.slice(sep + PAIR_SEPARATOR.length)]
}
