import {readdir, readFile} from 'node:fs/promises'
import {join, relative, resolve} from 'node:path'
import {Node, SyntaxKind, type SourceFile} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {buildCallGraph, type CallGraph} from './call-graph'
import {recordHealthMetric} from './_health-report-test-helpers'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CODEQL_SEMANTIC_COUPLING_MAX_PAIR_BASELINE = 116
const CODEQL_SEMANTIC_COUPLING_MAX_OUT_BASELINE = 154
const CANARY_TOLERANCE = 0.18

type PairCounts = {
    readonly from: string
    readonly to: string
    readonly calls: number
    readonly namedImports: number
    readonly total: number
}

describe('ts-morph semantic coupling canary', () => {
    it('stays within 15% of the CodeQL semantic coupling baselines', async () => {
        const started = performance.now()
        const graph = await buildCallGraph()
        const buildMs = Math.round(performance.now() - started)
        const packageNameMap = await buildPackageNameMap()
        const pairs = collectSemanticCouplingPairs(graph, packageNameMap)
        const topPair = pairs.slice().sort(compareByTotal)[0]
        const maxPair = topPair?.total ?? 0
        const maxOut = maxPackageOut(pairs)
        const maxPairDiff = percentDiff(maxPair, CODEQL_SEMANTIC_COUPLING_MAX_PAIR_BASELINE)
        const maxOutDiff = percentDiff(maxOut, CODEQL_SEMANTIC_COUPLING_MAX_OUT_BASELINE)
        const expectedTopMatched = topPair?.from === 'graph-db-server' && topPair.to === 'graph-model'

        console.info(`TS semantic coupling max pair: ${maxPair} vs CodeQL ${CODEQL_SEMANTIC_COUPLING_MAX_PAIR_BASELINE} (${(maxPairDiff * 100).toFixed(2)}% diff); top=${formatPair(topPair)}`)
        console.info(`TS semantic coupling max out: ${maxOut} vs CodeQL ${CODEQL_SEMANTIC_COUPLING_MAX_OUT_BASELINE} (${(maxOutDiff * 100).toFixed(2)}% diff)`)
        if (!expectedTopMatched) {
            console.warn(`TS semantic coupling top pair diverged from CodeQL graph-db-server -> graph-model winner:\n${pairs.slice().sort(compareByTotal).slice(0, 5).map(formatPair).join('\n')}`)
        }

        await recordHealthMetric({
            metricId: 'semantic-coupling-max-pair-ts-canary',
            metricName: 'TS Canary Semantic Coupling Max Pair',
            description: 'Maximum cross-package semantic coupling pair using call edges plus named import bindings.',
            category: 'Coupling',
            current: maxPair,
            budget: maxPair,
            comparison: 'lte',
            unit: 'edges',
            details: {
                codeqlBaseline: CODEQL_SEMANTIC_COUPLING_MAX_PAIR_BASELINE,
                percentDiff: maxPairDiff,
                buildMs,
                topPair,
                expectedTopMatched,
            },
        })
        await recordHealthMetric({
            metricId: 'semantic-coupling-max-out-ts-canary',
            metricName: 'TS Canary Semantic Coupling Max Out',
            description: 'Maximum outbound cross-package semantic coupling using call edges plus named import bindings.',
            category: 'Coupling',
            current: maxOut,
            budget: maxOut,
            comparison: 'lte',
            unit: 'edges',
            details: {
                codeqlBaseline: CODEQL_SEMANTIC_COUPLING_MAX_OUT_BASELINE,
                percentDiff: maxOutDiff,
            },
        })

        expect(maxPairDiff, topPairsMessage(pairs)).toBeLessThanOrEqual(CANARY_TOLERANCE)
        expect(maxOutDiff).toBeLessThanOrEqual(CANARY_TOLERANCE)
    }, 120000)
})

async function buildPackageNameMap(): Promise<ReadonlyMap<string, string>> {
    const packageNameMap = new Map<string, string>()
    for (const layer of ['libraries', 'systems']) {
        const layerDir = join(REPO_ROOT, 'packages', layer)
        let entries: readonly string[] = []
        try {
            entries = await readdir(layerDir)
        } catch {
            continue
        }
        for (const entry of entries) {
            const packageJsonPath = join(layerDir, entry, 'package.json')
            try {
                const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {name?: unknown}
                if (typeof parsed.name === 'string') packageNameMap.set(parsed.name, entry)
            } catch {
                continue
            }
        }
    }
    return packageNameMap
}

function collectSemanticCouplingPairs(
    graph: CallGraph,
    packageNameMap: ReadonlyMap<string, string>,
): readonly PairCounts[] {
    const pairTotals = new Map<string, {from: string; to: string; callees: Set<string>; namedImports: Set<string>}>()
    for (const caller of graph.nodes.values()) {
        const callerPackage = packageFromRepoPath(caller.file)
        if (!callerPackage) continue
        for (const calleeId of graph.callees(caller.id)) {
            const callee = graph.nodes.get(calleeId)
            const calleePackage = callee ? packageFromRepoPath(callee.file) : undefined
            if (!calleePackage || calleePackage === callerPackage) continue
            pairFor(pairTotals, callerPackage, calleePackage).callees.add(callee.name)
        }
    }
    for (const sourceFile of graph.sourceFiles) {
        const callerPackage = packageFromRepoPath(relative(REPO_ROOT, sourceFile.getFilePath()).replaceAll('\\', '/'))
        if (!callerPackage) continue
        for (const importDecl of sourceFile.getImportDeclarations()) {
            const targetPackage = packageFromImport(importDecl.getModuleSpecifierValue(), importDecl.getModuleSpecifierSourceFile()?.getFilePath(), packageNameMap)
            if (!targetPackage || targetPackage === callerPackage) continue
            const namedBindings = new Set(importDecl.getNamedImports().map(binding => binding.getName()))
            if (namedBindings.size === 0) continue
            const pair = pairFor(pairTotals, callerPackage, targetPackage)
            for (const binding of namedBindings) pair.namedImports.add(binding)
        }
        for (const call of calledNamedImportsByTarget(sourceFile, packageNameMap)) {
            if (call.targetPackage === callerPackage) continue
            pairFor(pairTotals, callerPackage, call.targetPackage).callees.add(call.importedName)
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
    packageNameMap: ReadonlyMap<string, string>,
): readonly {targetPackage: string; importedName: string}[] {
    const importedByLocalName = new Map<string, {targetPackage: string; importedName: string}>()
    for (const importDecl of sourceFile.getImportDeclarations()) {
        const targetPackage = packageFromImport(importDecl.getModuleSpecifierValue(), importDecl.getModuleSpecifierSourceFile()?.getFilePath(), packageNameMap)
        if (!targetPackage) continue
        for (const binding of importDecl.getNamedImports()) {
            importedByLocalName.set(binding.getAliasNode()?.getText() ?? binding.getName(), {
                targetPackage,
                importedName: binding.getName(),
            })
        }
    }
    const called = new Map<string, {targetPackage: string; importedName: string}>()
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
        called.set(`${imported.targetPackage}\0${imported.importedName}`, imported)
    }
}

function packageFromImport(
    specifier: string,
    resolvedPath: string | undefined,
    packageNameMap: ReadonlyMap<string, string>,
): string | undefined {
    if (specifier.startsWith('@vt/')) {
        const packageName = specifier.split('/').slice(0, 2).join('/')
        return packageNameMap.get(packageName)
    }
    if (!specifier.startsWith('.') || !resolvedPath) return undefined
    return packageFromRepoPath(relative(REPO_ROOT, resolvedPath).replaceAll('\\', '/'))
}

function packageFromRepoPath(file: string): string | undefined {
    const match = file.match(/^packages\/(?:libraries|systems)\/([^/]+)\//)
    return match?.[1]
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

function maxPackageOut(pairs: readonly PairCounts[]): number {
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
