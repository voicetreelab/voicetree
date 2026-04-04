import type { ContainmentTree } from './lintContainment'

export type ClassifiedEdge = {
    source: string
    target: string
    type: 'parent' | 'sibling' | 'cross_ref'
}

export type NodeMetrics = {
    nChildren: number
    nSiblingEdges: number
    attentionItems: number
    siblingEdgeDensity: number
    depth: number
    nCrossRefs: number
    nodeCost: number
}

export type LintResult = {
    nodeId: string
    ruleId: string
    severity: 'violation' | 'warning'
    value: number
    threshold: number
    theoryBasis: string
    suggestion: string
}

export type LintConfig = {
    maxArity: number
    maxAttentionItems: number
    highCouplingThreshold: number
    combinatorialCouplingThreshold: number
    wideCrossRefThreshold: number
}

export const DEFAULT_LINT_CONFIG: LintConfig = {
    maxArity: 7,
    maxAttentionItems: 7,
    highCouplingThreshold: 0.5,
    combinatorialCouplingThreshold: 0.5,
    wideCrossRefThreshold: 3,
}

export function classifyEdges(
    allResolvedLinks: Map<string, string[]>,
    containment: ContainmentTree
): ClassifiedEdge[] {
    const edges: ClassifiedEdge[] = []

    for (const [source, targets] of allResolvedLinks.entries()) {
        const parent: string | null | undefined = containment.parentOf.get(source)
        const siblings: Set<string> = new Set(
            parent !== null && parent !== undefined
                ? (containment.childrenOf.get(parent) ?? []).filter(id => id !== source)
                : []
        )

        for (const target of targets) {
            if (target === parent) {
                edges.push({ source, target, type: 'parent' })
            } else if (siblings.has(target)) {
                edges.push({ source, target, type: 'sibling' })
            } else {
                edges.push({ source, target, type: 'cross_ref' })
            }
        }
    }

    return edges
}

function computeDepth(nodeId: string, parentOf: ReadonlyMap<string, string | null>): number {
    let depth: number = 0
    let current: string | null | undefined = parentOf.get(nodeId)
    const visited: Set<string> = new Set()
    while (current !== null && current !== undefined) {
        if (visited.has(current)) break
        visited.add(current)
        depth += 1
        current = parentOf.get(current)
    }
    return depth
}

function countUndirectedSiblingEdges(
    nodeId: string,
    edges: readonly ClassifiedEdge[],
    containment: ContainmentTree
): number {
    const children: Set<string> = new Set(containment.childrenOf.get(nodeId) ?? [])
    if (children.size < 2) return 0

    const edgePairs: Set<string> = new Set()
    for (const edge of edges) {
        if (edge.type !== 'sibling') continue
        if (children.has(edge.source) && children.has(edge.target)) {
            const pair: string = [edge.source, edge.target].sort().join('↔')
            edgePairs.add(pair)
        }
    }
    return edgePairs.size
}

function choose2(n: number): number {
    return n < 2 ? 0 : (n * (n - 1)) / 2
}

function computeDependencyScaling(
    attentionItems: number,
    siblingEdgeDensity: number,
    config: LintConfig
): number {
    if (siblingEdgeDensity < 0.2) return 1.0
    if (siblingEdgeDensity < config.combinatorialCouplingThreshold) return attentionItems
    return attentionItems * attentionItems
}

export function computeNodeMetrics(
    nodeId: string,
    containment: ContainmentTree,
    edges: readonly ClassifiedEdge[],
    config: LintConfig
): NodeMetrics {
    const children: string[] = containment.childrenOf.get(nodeId) ?? []
    const nChildren: number = children.length
    const nSiblingEdges: number = countUndirectedSiblingEdges(nodeId, edges, containment)
    const attentionItems: number = nChildren + nSiblingEdges
    const maxPossibleEdges: number = choose2(nChildren)
    const siblingEdgeDensity: number = maxPossibleEdges > 0 ? nSiblingEdges / maxPossibleEdges : 0
    const depth: number = computeDepth(nodeId, containment.parentOf)
    const nCrossRefs: number = edges.filter(e => e.source === nodeId && e.type === 'cross_ref').length
    const dependencyScaling: number = computeDependencyScaling(attentionItems, siblingEdgeDensity, config)
    const nodeCost: number = attentionItems * dependencyScaling

    return { nChildren, nSiblingEdges, attentionItems, siblingEdgeDensity, depth, nCrossRefs, nodeCost }
}

export function checkRules(
    nodeId: string,
    metrics: NodeMetrics,
    config: LintConfig,
    totalNodes: number
): LintResult[] {
    const results: LintResult[] = []

    if (metrics.nChildren > config.maxArity) {
        results.push({
            nodeId, ruleId: 'OVERLOADED_NODE', severity: 'violation',
            value: metrics.nChildren, threshold: config.maxArity,
            theoryBasis: 'Chunk 1: superlinear cost wall at ~7',
            suggestion: 'Decompose into subgroups',
        })
    }

    if (metrics.attentionItems > config.maxAttentionItems) {
        results.push({
            nodeId, ruleId: 'ATTENTION_OVERFLOW', severity: 'violation',
            value: metrics.attentionItems, threshold: config.maxAttentionItems,
            theoryBasis: 'Chunk 1: total items exceed ~7 slot budget',
            suggestion: 'Decouple siblings or restructure',
        })
    }

    if (metrics.siblingEdgeDensity > config.highCouplingThreshold && metrics.nChildren >= 2) {
        results.push({
            nodeId, ruleId: 'HIGH_SIBLING_COUPLING', severity: 'warning',
            value: metrics.siblingEdgeDensity, threshold: config.highCouplingThreshold,
            theoryBasis: 'SA §7: high density = false boundaries',
            suggestion: 'Should siblings be merged into one unit?',
        })
    }

    if (metrics.nChildren === 1) {
        results.push({
            nodeId, ruleId: 'SINGLETON_COMPOUND', severity: 'warning',
            value: 1, threshold: 1,
            theoryBasis: 'Boundary test: extraction must absorb ≥2 dims',
            suggestion: 'Does folder boundary earn its name?',
        })
    }

    if (totalNodes > 1) {
        const branchingFactor: number = 3
        const depthThreshold: number = 2 * Math.ceil(Math.log(totalNodes) / Math.log(branchingFactor))
        if (metrics.depth > depthThreshold) {
            results.push({
                nodeId, ruleId: 'DEEP_CHAIN', severity: 'warning',
                value: metrics.depth, threshold: depthThreshold,
                theoryBasis: 'Width-depth tradeoff: navigation cost ceiling',
                suggestion: 'Consider flattening',
            })
        }
    }

    if (metrics.nCrossRefs > config.wideCrossRefThreshold) {
        results.push({
            nodeId, ruleId: 'WIDE_CROSS_REF', severity: 'warning',
            value: metrics.nCrossRefs, threshold: config.wideCrossRefThreshold,
            theoryBasis: 'Encoding principle: each cross-ref is forced attention',
            suggestion: 'Can some be containment instead?',
        })
    }

    return results
}

export function findDuplicateEdges(
    nodeId: string,
    rawLinks: string[],
    resolvedLinks: string[]
): LintResult[] {
    const seen: Map<string, number> = new Map()
    for (const target of resolvedLinks) {
        seen.set(target, (seen.get(target) ?? 0) + 1)
    }

    const results: LintResult[] = []
    for (const [target, count] of seen.entries()) {
        if (count >= 2) {
            results.push({
                nodeId, ruleId: 'DUPLICATE_EDGE', severity: 'violation',
                value: count, threshold: 2,
                theoryBasis: 'Encoding principle: redundant forced attention',
                suggestion: `Remove duplicate link to ${target}`,
            })
        }
    }
    return results
}

export function findOrphans(
    nodeIds: string[],
    containment: ContainmentTree,
    allResolvedLinks: Map<string, string[]>
): LintResult[] {
    const hasIncoming: Set<string> = new Set()
    for (const targets of allResolvedLinks.values()) {
        for (const target of targets) {
            hasIncoming.add(target)
        }
    }

    const results: LintResult[] = []
    for (const nodeId of nodeIds) {
        const hasChildren: boolean = (containment.childrenOf.get(nodeId) ?? []).length > 0
        const hasParent: boolean = containment.parentOf.get(nodeId) !== null
        const hasOutgoing: boolean = (allResolvedLinks.get(nodeId) ?? []).length > 0
        const incoming: boolean = hasIncoming.has(nodeId)

        if (!hasChildren && !hasParent && !hasOutgoing && !incoming) {
            results.push({
                nodeId, ruleId: 'ORPHAN', severity: 'warning',
                value: 0, threshold: 0,
                theoryBasis: 'Fidelity proxy: disconnected = missing structure',
                suggestion: 'Should this connect somewhere?',
            })
        }
    }
    return results
}
