import {dirname, relative, resolve} from 'node:path'
import {Node, SyntaxKind, type SourceFile} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {buildCallGraph, type CallGraph} from '../../_shared/graph/call-graph'
import {communityAtDepth} from '../../_shared/community/community-at-depth.ts'
import {discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..')
// Captured 2026-05-15 after widening discovery to whole repo and measuring
// max community-level coupling across all directory containment depths.
const SEMANTIC_COUPLING_MAX_PAIR_BASELINE = 217
const SEMANTIC_COUPLING_MAX_OUT_BASELINE = 497
const CANARY_TOLERANCE = 0.18

type PairCounts = {
    readonly from: string
    readonly to: string
    readonly calls: number
    readonly namedImports: number
    readonly total: number
}

type SourceCommunity = {
    readonly packageName: string
    readonly relToSrc: string
}

type PackageContext = {
    readonly packagesByName: ReadonlyMap<string, PackageInfo>
    readonly packagesBySrcRoot: readonly PackageInfo[]
}

describe('ts-morph semantic coupling canary', () => {
    it('stays within 18% of the semantic coupling ratchet baselines', async () => {
        const started = performance.now()
        const packages = await discoverPackages(REPO_ROOT)
        const graph = await buildCallGraph(REPO_ROOT, packages)
        const buildMs = Math.round(performance.now() - started)
        const pairReports = collectSemanticCouplingPairReports(graph, packages)
        const pairs = pairReports.flatMap(report => report.pairs)
        const topPair = pairs.slice().sort(compareByTotal)[0]
        const maxPair = topPair?.total ?? 0
        const maxOut = Math.max(0, ...pairReports.map(report => maxCommunityOut(report.pairs)))
        const maxPairDiff = percentDiff(maxPair, SEMANTIC_COUPLING_MAX_PAIR_BASELINE)
        const maxOutDiff = percentDiff(maxOut, SEMANTIC_COUPLING_MAX_OUT_BASELINE)
        const expectedTopMatched = topPair?.from === 'webapp/shell' && topPair.to === 'graph-model/__root__'

        console.info(`TS semantic coupling max pair: ${maxPair} vs baseline ${SEMANTIC_COUPLING_MAX_PAIR_BASELINE} (${(maxPairDiff * 100).toFixed(2)}% diff); top=${formatPair(topPair)}`)
        console.info(`TS semantic coupling max out: ${maxOut} vs baseline ${SEMANTIC_COUPLING_MAX_OUT_BASELINE} (${(maxOutDiff * 100).toFixed(2)}% diff)`)
        if (!expectedTopMatched) {
            console.warn(`TS semantic coupling top pair diverged from webapp/shell -> graph-model/__root__ winner:\n${pairs.slice().sort(compareByTotal).slice(0, 5).map(formatPair).join('\n')}`)
        }

        await recordHealthMetric({
            metricId: 'semantic-coupling-max-pair-ts-canary',
            metricName: 'TS Canary Semantic Coupling Max Pair',
            description: 'Maximum cross-community semantic coupling pair using call edges plus named import bindings.',
            category: 'Coupling',
            current: maxPair,
            budget: maxPair,
            comparison: 'lte',
            unit: 'edges',
            details: {
                baseline: SEMANTIC_COUPLING_MAX_PAIR_BASELINE,
                percentDiff: maxPairDiff,
                buildMs,
                maxDepth: pairReports.at(-1)?.depth ?? 0,
                topPair,
                topByDepth: pairReports.map(report => ({
                    depth: report.depth,
                    topPair: report.pairs.slice().sort(compareByTotal)[0],
                    maxOut: maxCommunityOut(report.pairs),
                })),
                expectedTopMatched,
            },
        })
        await recordHealthMetric({
            metricId: 'semantic-coupling-max-out-ts-canary',
            metricName: 'TS Canary Semantic Coupling Max Out',
            description: 'Maximum outbound cross-community semantic coupling using call edges plus named import bindings.',
            category: 'Coupling',
            current: maxOut,
            budget: maxOut,
            comparison: 'lte',
            unit: 'edges',
            details: {
                baseline: SEMANTIC_COUPLING_MAX_OUT_BASELINE,
                percentDiff: maxOutDiff,
                maxDepth: pairReports.at(-1)?.depth ?? 0,
            },
        })

        expect(maxPairDiff, topPairsMessage(pairs)).toBeLessThanOrEqual(CANARY_TOLERANCE)
        expect(maxOutDiff).toBeLessThanOrEqual(CANARY_TOLERANCE)
    }, 120000)
})

function buildPackageContext(packages: readonly PackageInfo[]): PackageContext {
    return {
        packagesByName: new Map(packages.map(pkg => [pkg.name, pkg])),
        packagesBySrcRoot: packages
            .slice()
            .sort((a, b) => b.srcRoot.length - a.srcRoot.length),
    }
}

function collectSemanticCouplingPairReports(
    graph: CallGraph,
    packages: readonly PackageInfo[],
): readonly {depth: number; pairs: readonly PairCounts[]}[] {
    const packageContext = buildPackageContext(packages)
    const sourceCommunities = graph.sourceFiles
        .map(sourceFile => sourceCommunityForPath(sourceFile.getFilePath(), packageContext))
        .filter((source): source is SourceCommunity => Boolean(source))
    const maxDepth = Math.max(0, ...sourceCommunities.map(source => {
        const dir = dirname(source.relToSrc)
        return dir === '.' ? 0 : dir.split('/').length
    }))

    const reports: {depth: number; pairs: readonly PairCounts[]}[] = []
    for (let depth = 1; depth <= maxDepth; depth++) {
        reports.push({
            depth,
            pairs: collectSemanticCouplingPairsAtDepth(graph, packageContext, depth),
        })
    }
    return reports
}

function collectSemanticCouplingPairsAtDepth(
    graph: CallGraph,
    packageContext: PackageContext,
    depth: number,
): readonly PairCounts[] {
    const pairTotals = new Map<string, {from: string; to: string; callees: Set<string>; namedImports: Set<string>}>()
    for (const caller of graph.nodes.values()) {
        const callerSource = sourceCommunityForPath(caller.file, packageContext)
        if (!callerSource) continue
        const callerCommunity = communityAtDepth(callerSource.packageName, callerSource.relToSrc, depth)
        for (const calleeId of graph.callees(caller.id)) {
            const callee = graph.nodes.get(calleeId)
            if (!callee) continue
            const calleeSource = sourceCommunityForPath(callee.file, packageContext)
            if (!calleeSource) continue
            const calleeCommunity = communityAtDepth(calleeSource.packageName, calleeSource.relToSrc, depth)
            if (calleeCommunity === callerCommunity) continue
            pairFor(pairTotals, callerCommunity, calleeCommunity).callees.add(callee.name)
        }
    }
    for (const sourceFile of graph.sourceFiles) {
        const callerSource = sourceCommunityForPath(sourceFile.getFilePath(), packageContext)
        if (!callerSource) continue
        const callerCommunity = communityAtDepth(callerSource.packageName, callerSource.relToSrc, depth)
        for (const importDecl of sourceFile.getImportDeclarations()) {
            const targetSource = sourceCommunityFromImport(importDecl.getModuleSpecifierValue(), importDecl.getModuleSpecifierSourceFile()?.getFilePath(), packageContext)
            if (!targetSource) continue
            const targetCommunity = communityAtDepth(targetSource.packageName, targetSource.relToSrc, depth)
            if (targetCommunity === callerCommunity) continue
            const namedBindings = new Set(importDecl.getNamedImports().map(binding => binding.getName()))
            if (namedBindings.size === 0) continue
            const pair = pairFor(pairTotals, callerCommunity, targetCommunity)
            for (const binding of namedBindings) pair.namedImports.add(binding)
        }
        for (const call of calledNamedImportsByTarget(sourceFile, packageContext, depth)) {
            if (call.targetCommunity === callerCommunity) continue
            pairFor(pairTotals, callerCommunity, call.targetCommunity).callees.add(call.importedName)
        }
    }
    return [...pairTotals.values()].map(pair => ({
        from: pair.from,
        to: pair.to,
        calls: pair.callees.size,
        namedImports: pair.namedImports.size,
        total: pair.callees.size + pair.namedImports.size,
    }))
}

function calledNamedImportsByTarget(
    sourceFile: SourceFile,
    packageContext: PackageContext,
    depth: number,
): readonly {targetCommunity: string; importedName: string}[] {
    const importedByLocalName = new Map<string, {targetCommunity: string; importedName: string}>()
    for (const importDecl of sourceFile.getImportDeclarations()) {
        const targetSource = sourceCommunityFromImport(importDecl.getModuleSpecifierValue(), importDecl.getModuleSpecifierSourceFile()?.getFilePath(), packageContext)
        if (!targetSource) continue
        const targetCommunity = communityAtDepth(targetSource.packageName, targetSource.relToSrc, depth)
        for (const binding of importDecl.getNamedImports()) {
            importedByLocalName.set(binding.getAliasNode()?.getText() ?? binding.getName(), {
                targetCommunity,
                importedName: binding.getName(),
            })
        }
    }
    const called = new Map<string, {targetCommunity: string; importedName: string}>()
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        addCalledImport(call.getExpression())
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        addCalledImport(call.getExpression())
    }
    return [...called.values()]

    function addCalledImport(expression: Node): void {
        if (!Node.isIdentifier(expression)) return
        const imported = importedByLocalName.get(expression.getText())
        if (!imported) return
        called.set(`${imported.targetCommunity}\0${imported.importedName}`, imported)
    }
}

function sourceCommunityFromImport(
    specifier: string,
    resolvedPath: string | undefined,
    packageContext: PackageContext,
): SourceCommunity | undefined {
    const resolvedSource = resolvedPath ? sourceCommunityForPath(resolvedPath, packageContext) : undefined
    if (resolvedSource) return resolvedSource

    if (!specifier.startsWith('.')) {
        for (const [packageName, pkg] of packageContext.packagesByName) {
            if (specifier !== packageName && !specifier.startsWith(packageName + '/')) continue
            const subPath = specifier === packageName ? 'index.ts' : specifier.slice(packageName.length + 1)
            return {packageName: pkg.dirName, relToSrc: subPath}
        }
    }
    if (!resolvedPath) return undefined
    return sourceCommunityForPath(resolvedPath, packageContext)
}

function sourceCommunityForPath(file: string, packageContext: PackageContext): SourceCommunity | undefined {
    const absPath = normalizePath(resolve(REPO_ROOT, file))
    for (const pkg of packageContext.packagesBySrcRoot) {
        const srcRoot = normalizePath(pkg.srcRoot).replace(/\/$/, '')
        if (absPath !== srcRoot && !absPath.startsWith(srcRoot + '/')) continue
        return {
            packageName: pkg.dirName,
            relToSrc: normalizePath(relative(pkg.srcRoot, absPath)),
        }
    }
    return undefined
}

function pairFor(
    pairs: Map<string, {from: string; to: string; callees: Set<string>; namedImports: Set<string>}>,
    from: string,
    to: string,
): {from: string; to: string; callees: Set<string>; namedImports: Set<string>} {
    const key = `${from}\0${to}`
    const current = pairs.get(key)
    if (current) return current
    const created = {from, to, callees: new Set<string>(), namedImports: new Set<string>()}
    pairs.set(key, created)
    return created
}

function maxCommunityOut(pairs: readonly PairCounts[]): number {
    const totals = new Map<string, number>()
    for (const pair of pairs) {
        totals.set(pair.from, (totals.get(pair.from) ?? 0) + pair.total)
    }
    return Math.max(0, ...totals.values())
}

function percentDiff(current: number, baseline: number): number {
    return Math.abs(current - baseline) / baseline
}

function compareByTotal(a: PairCounts, b: PairCounts): number {
    return b.total - a.total
        || b.calls - a.calls
        || b.namedImports - a.namedImports
        || a.from.localeCompare(b.from)
        || a.to.localeCompare(b.to)
}

function formatPair(pair: PairCounts | undefined): string {
    if (!pair) return '<none>'
    return `${pair.from} -> ${pair.to}: total=${pair.total} calls=${pair.calls} namedImports=${pair.namedImports}`
}

function topPairsMessage(pairs: readonly PairCounts[]): string {
    return `TS semantic coupling max-pair canary is outside tolerance.\nTop pairs:\n${pairs.slice().sort(compareByTotal).slice(0, 5).map(formatPair).join('\n')}`
}

function normalizePath(path: string): string {
    return path.replaceAll('\\', '/')
}
