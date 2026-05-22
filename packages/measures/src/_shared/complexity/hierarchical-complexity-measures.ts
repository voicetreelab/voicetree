type EdgeWithPaths = {
    readonly from: { readonly absolutePath: string }
    readonly to: { readonly absolutePath: string }
}

export function computeTreeWidth(crossEdges: readonly EdgeWithPaths[], boundaryFiles: ReadonlySet<string>): number {
    if (boundaryFiles.size === 0) return 0
    const adjacency = new Map<string, Set<string>>()
    for (const f of boundaryFiles) adjacency.set(f, new Set())
    for (const e of crossEdges) {
        adjacency.get(e.from.absolutePath)?.add(e.to.absolutePath)
        adjacency.get(e.to.absolutePath)?.add(e.from.absolutePath)
    }

    const unnumbered = new Set(adjacency.keys())
    const numbered = new Set<string>()
    let maxBag = 0

    while (unnumbered.size > 0) {
        let best = ''
        let bestCount = -1
        for (const f of unnumbered) {
            const count = [...(adjacency.get(f) ?? [])].filter(n => numbered.has(n)).length
            if (count > bestCount || (count === bestCount && f < best)) {
                best = f
                bestCount = count
            }
        }
        maxBag = Math.max(maxBag, bestCount + 1)
        numbered.add(best)
        unnumbered.delete(best)
    }

    return Math.max(0, maxBag - 1)
}

export function computeNormalizedEntropy(
    crossEdges: readonly EdgeWithPaths[],
    communityNames: readonly string[],
    fileCommunities: ReadonlyMap<string, string>,
): number {
    if (communityNames.length < 2) return 0
    const degrees = new Map<string, number>()
    for (const name of communityNames) degrees.set(name, 0)

    for (const e of crossEdges) {
        const fromC = fileCommunities.get(e.from.absolutePath)!
        const toC = fileCommunities.get(e.to.absolutePath)!
        degrees.set(fromC, (degrees.get(fromC) ?? 0) + 1)
        degrees.set(toC, (degrees.get(toC) ?? 0) + 1)
    }

    const totalDegree = [...degrees.values()].reduce((a, b) => a + b, 0)
    if (totalDegree === 0) return 0

    let entropy = 0
    for (const d of degrees.values()) {
        if (d === 0) continue
        const p = d / totalDegree
        entropy -= p * Math.log2(p)
    }

    return entropy / Math.log2(communityNames.length)
}

export function computeDsm(
    crossEdges: readonly EdgeWithPaths[],
    communityNames: readonly string[],
    shortNames: readonly string[],
    fileCommunities: ReadonlyMap<string, string>,
): { names: readonly string[]; matrix: readonly (readonly number[])[] } {
    const idx = new Map(communityNames.map((n, i) => [n, i]))
    const n = communityNames.length
    const matrix: number[][] = Array.from({length: n}, () => Array(n).fill(0))

    for (const e of crossEdges) {
        const fromIdx = idx.get(fileCommunities.get(e.from.absolutePath)!)!
        const toIdx = idx.get(fileCommunities.get(e.to.absolutePath)!)!
        matrix[fromIdx][toIdx]++
    }

    return {names: shortNames, matrix}
}

export function computeModularityQ(
    intraGroupEdges: readonly EdgeWithPaths[],
    fileCommunities: ReadonlyMap<string, string>,
    communityNames: readonly string[],
): number {
    if (communityNames.length < 2) return 0

    const communitySet = new Set(communityNames)
    const uniqueEdgeKeys = new Set<string>()
    const uniqueEdges: EdgeWithPaths[] = []

    for (const edge of intraGroupEdges) {
        const fromPath = edge.from.absolutePath
        const toPath = edge.to.absolutePath
        if (fromPath === toPath) continue

        const fromCommunity = fileCommunities.get(fromPath)
        const toCommunity = fileCommunities.get(toPath)
        if (!fromCommunity || !toCommunity) continue
        if (!communitySet.has(fromCommunity) || !communitySet.has(toCommunity)) continue

        const key = [fromPath, toPath].sort().join('\0')
        if (uniqueEdgeKeys.has(key)) continue
        uniqueEdgeKeys.add(key)
        uniqueEdges.push(edge)
    }

    const edgeCount = uniqueEdges.length
    if (edgeCount === 0) return 0

    const degreeByFile = new Map<string, number>()
    const internalEdgesByCommunity = new Map(communityNames.map(name => [name, 0]))

    for (const edge of uniqueEdges) {
        const fromPath = edge.from.absolutePath
        const toPath = edge.to.absolutePath
        const fromCommunity = fileCommunities.get(fromPath)!
        const toCommunity = fileCommunities.get(toPath)!

        degreeByFile.set(fromPath, (degreeByFile.get(fromPath) ?? 0) + 1)
        degreeByFile.set(toPath, (degreeByFile.get(toPath) ?? 0) + 1)

        if (fromCommunity === toCommunity) {
            internalEdgesByCommunity.set(fromCommunity, (internalEdgesByCommunity.get(fromCommunity) ?? 0) + 1)
        }
    }

    const degreeSumByCommunity = new Map(communityNames.map(name => [name, 0]))
    for (const [filePath, degree] of degreeByFile) {
        const community = fileCommunities.get(filePath)
        if (!community || !communitySet.has(community)) continue
        degreeSumByCommunity.set(community, (degreeSumByCommunity.get(community) ?? 0) + degree)
    }

    return communityNames.reduce((sum, community) => {
        const internalEdges = internalEdgesByCommunity.get(community) ?? 0
        const degreeSum = degreeSumByCommunity.get(community) ?? 0
        return sum + (internalEdges / edgeCount) - (degreeSum / (2 * edgeCount)) ** 2
    }, 0)
}
