import type {GraphEdge, SystemFile, SystemGraph} from './types.test'

function mcsTreeWidthLowerBound(nodes: readonly string[], pairs: readonly (readonly [string, string])[]): number {
    if (nodes.length <= 1) return 0
    const adjacency = new Map(nodes.map(node => [node, new Set<string>()]))
    for (const [a, b] of pairs) {
        adjacency.get(a)?.add(b)
        adjacency.get(b)?.add(a)
    }

    const numbered = new Set<string>()
    let maxWidth = 0
    for (let i = 0; i < nodes.length; i += 1) {
        let bestNode = ''
        let bestCount = -1
        for (const node of nodes) {
            if (numbered.has(node)) continue
            let count = 0
            for (const neighbor of adjacency.get(node) ?? []) {
                if (numbered.has(neighbor)) count += 1
            }
            if (count > bestCount) {
                bestNode = node
                bestCount = count
            }
        }
        if (bestCount > 0) maxWidth = Math.max(maxWidth, bestCount)
        numbered.add(bestNode)
    }
    return maxWidth
}

export function measureBoundaries(files: readonly SystemFile[], edges: readonly GraphEdge[], packageNames: readonly string[]) {
    const boundaryFiles = new Map(packageNames.map(name => [name, new Set<string>()]))
    for (const edge of edges) {
        if (edge.fromPackage === edge.toPackage) continue
        boundaryFiles.get(edge.fromPackage)?.add(edge.from)
        boundaryFiles.get(edge.toPackage)?.add(edge.to)
    }

    const filesByPackage = new Map(packageNames.map(name => [name, files.filter(file => file.packageName === name)]))
    const boundaryProfiles = packageNames.map(packageName => {
        const totalFiles = filesByPackage.get(packageName)?.length ?? 0
        const count = boundaryFiles.get(packageName)?.size ?? 0
        return {packageName, boundaryFiles: count, totalFiles, ratio: totalFiles === 0 ? 0 : count / totalFiles}
    }).sort((a, b) => b.ratio - a.ratio)

    const subdirProfiles = packageNames.map(packageName => {
        const internalEdges = edges.filter(edge => edge.fromPackage === packageName && edge.toPackage === packageName)
        const crossSubdirEdges = internalEdges.filter(edge => edge.fromSubdirectory !== edge.toSubdirectory)
        return {packageName, internalEdges: internalEdges.length, crossSubdirEdges: crossSubdirEdges.length, ratio: internalEdges.length === 0 ? 0 : crossSubdirEdges.length / internalEdges.length}
    }).sort((a, b) => b.ratio - a.ratio)

    const pairGroups = new Map<string, GraphEdge[]>()
    for (const edge of edges) {
        if (edge.fromPackage === edge.toPackage) continue
        const key = `${edge.fromPackage} -> ${edge.toPackage}`
        const pairEdges = pairGroups.get(key) ?? []
        pairEdges.push(edge)
        pairGroups.set(key, pairEdges)
    }

    const pairMetrics = [...pairGroups.entries()].map(([pair, pairEdges]) => {
        const src = new Set(pairEdges.map(edge => edge.from))
        const tgt = new Set(pairEdges.map(edge => edge.to))
        const srcNodes = [...src].map(file => `src:${file}`)
        const tgtNodes = [...tgt].map(file => `tgt:${file}`)
        const pairs = pairEdges.map(edge => [`src:${edge.from}`, `tgt:${edge.to}`] as const)
        const treeWidth = mcsTreeWidthLowerBound([...srcNodes, ...tgtNodes], pairs)
        const density = src.size === 0 || tgt.size === 0 ? 0 : pairEdges.length / (src.size * tgt.size)
        return {pair, srcFan: src.size, tgtFan: tgt.size, edgeCount: pairEdges.length, density, treeWidth, bci: (treeWidth + 1) * Math.log2(pairEdges.length + 1)}
    }).sort((a, b) => b.bci - a.bci || a.pair.localeCompare(b.pair))

    return {
        boundaryProfiles,
        subdirProfiles,
        pairMetrics,
        aggregateBci: pairMetrics.reduce((sum, pair) => sum + pair.bci, 0),
    }
}

export function runtimeFanInRows(runtimeSymbolsByTarget: SystemGraph['runtimeSymbolsByTarget']) {
    return [...runtimeSymbolsByTarget.entries()].map(([packageName, symbols]) => ({
        packageName,
        runtimeSymbols: symbols.size,
        top: [...symbols.entries()]
            .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([symbol, files]) => `${symbol}(${files.size})`),
    })).sort((a, b) => b.runtimeSymbols - a.runtimeSymbols || a.packageName.localeCompare(b.packageName))
}
