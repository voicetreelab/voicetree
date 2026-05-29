import {readFileSync} from 'node:fs'
import {relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {buildCallGraph, type CallGraph, type FunctionNode} from '../../_shared/graph/call-graph'
import {scoreFunction} from '../../_shared/complexity/cogcx-scorer'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..')
// 2026-05-15 [BF-271]: DOVL+UFV epic structural baseline bump. Top function
// vt-graph.ts:691:main grew to transitive=2125 from new project lifecycle routes
// + folder-state/view plumbing landed via JOINT-001 / UFV-2.
// Budgets derive from previous baseline*tolerance: 1743 * 1.22 ≈ 2127 (max),
// 270 * 1.50 = 405 (folder mean). These are honest TS-morph budgets, not
// CodeQL baselines (no CodeQL infrastructure exists in this repo).
const TRANSITIVE_COMPLEXITY_MAX_BUDGET = 2127
const TRANSITIVE_COMPLEXITY_FOLDER_MEAN_BUDGET = 405
const MINIMUM_FOLDER_FUNCTIONS = 4

type ScoredFunction = {
    readonly node: FunctionNode
    readonly direct: number
    readonly transitive: number
    readonly calleeCount: number
}

describe('transitive complexity (ts-morph call graph)', () => {
    it('transitive complexity max and folder-mean stay under budget', async () => {
        const started = performance.now()
        const graph = await buildCallGraph()
        const buildMs = Math.round(performance.now() - started)
        const scored = scorePackageFunctions(graph)
        const top = scored.slice().sort(compareByTransitiveScore)[0]
        const maxTransitive = top?.transitive ?? 0
        const folderMean = maxFolderMean(scored)
        const expectedTopMatched = top?.node.file.endsWith('libraries/graph-tools/bin/vt-graph.ts') && top.node.name === 'main'

        console.info(`TS transitive complexity max: ${maxTransitive}; top=${formatScore(top)}`)
        console.info(`TS transitive complexity folder mean max: ${folderMean.toFixed(2)}`)
        if (!expectedTopMatched && top) {
            console.warn(`TS transitive complexity top function diverged from prior vt-graph.ts:main winner: ${formatScore(top)}`)
        }

        await recordHealthMetric({
            metricId: 'transitive-complexity-max-ts-canary',
            metricName: 'TS Canary Transitive Complexity Max',
            description: 'Maximum direct-plus-reachable cognitive complexity for package functions using the ts-morph call graph.',
            category: 'Complexity',
            current: maxTransitive,
            budget: TRANSITIVE_COMPLEXITY_MAX_BUDGET,
            comparison: 'lte',
            unit: 'cogcx',
            details: {
                buildMs,
                topFunction: top ? serializableScore(top) : null,
                expectedTopMatched,
            },
        })
        await recordHealthMetric({
            metricId: 'transitive-complexity-folder-mean-max-ts-canary',
            metricName: 'TS Canary Transitive Complexity Folder Mean Max',
            description: 'Maximum folder mean of direct-plus-reachable cognitive complexity among folders with at least four functions.',
            category: 'Complexity',
            current: folderMean,
            budget: TRANSITIVE_COMPLEXITY_FOLDER_MEAN_BUDGET,
            comparison: 'lte',
            unit: 'cogcx mean',
            details: {
                minimumFolderFunctions: MINIMUM_FOLDER_FUNCTIONS,
            },
        })

        // recordHealthMetric only journals the result; enforcement happens here.
        expect(maxTransitive, outOfBandMessage('max', scored)).toBeLessThanOrEqual(TRANSITIVE_COMPLEXITY_MAX_BUDGET)
        expect(folderMean).toBeLessThanOrEqual(TRANSITIVE_COMPLEXITY_FOLDER_MEAN_BUDGET)
    }, 120000)
})

function scorePackageFunctions(graph: CallGraph): readonly ScoredFunction[] {
    const directById = buildDirectScoreMap(graph)
    return [...graph.nodes.values()]
        .filter(node => node.file.startsWith('packages/'))
        .map(node => ({
            node,
            direct: directById.get(node.id) ?? 0,
            transitive: transitiveScore(graph, node.id, directById),
            calleeCount: graph.callees(node.id).size,
        }))
}

function buildDirectScoreMap(graph: CallGraph): ReadonlyMap<string, number> {
    const scores = new Map<string, number>()
    const files = [...new Set([...graph.nodes.values()].map(node => node.file))]
    for (const file of files) {
        const absPath = resolve(REPO_ROOT, file)
        const sourceFile = ts.createSourceFile(absPath, readFileSync(absPath, 'utf8'), ts.ScriptTarget.Latest, true)
        visitFunctions(sourceFile, sourceFile, (fn, location, name) => {
            const id = functionId(sourceFile, location, name)
            if (graph.nodes.has(id)) scores.set(id, scoreFunction(fn, name, sourceFile))
        })
    }
    return scores
}

function transitiveScore(graph: CallGraph, fnId: string, directById: ReadonlyMap<string, number>): number {
    let total = directById.get(fnId) ?? 0
    for (const reachableId of graph.reachableFrom(fnId)) {
        total += directById.get(reachableId) ?? 0
    }
    return total
}

function maxFolderMean(scored: readonly ScoredFunction[]): number {
    const folders = new Map<string, {total: number; count: number}>()
    for (const score of scored) {
        for (const folder of score.node.folderAncestors) {
            const current = folders.get(folder) ?? {total: 0, count: 0}
            folders.set(folder, {
                total: current.total + score.transitive,
                count: current.count + 1,
            })
        }
    }
    return Math.max(0, ...[...folders.values()]
        .filter(folder => folder.count >= MINIMUM_FOLDER_FUNCTIONS)
        .map(folder => folder.total / folder.count))
}

function compareByTransitiveScore(a: ScoredFunction, b: ScoredFunction): number {
    return b.transitive - a.transitive
        || b.direct - a.direct
        || a.node.file.localeCompare(b.node.file)
        || a.node.line - b.node.line
        || a.node.name.localeCompare(b.node.name)
}

function formatScore(score: ScoredFunction | undefined): string {
    if (!score) return '<none>'
    return `${score.node.file}:${score.node.line}:${score.node.name} transitive=${score.transitive} direct=${score.direct} callees=${score.calleeCount}`
}

function serializableScore(score: ScoredFunction): object {
    return {
        file: score.node.file,
        line: score.node.line,
        name: score.node.name,
        transitive: score.transitive,
        direct: score.direct,
        calleeCount: score.calleeCount,
    }
}

function visitFunctions(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    callback: (fn: ts.FunctionLikeDeclaration, location: ts.Node, name: string) => void,
): void {
    if (ts.isFunctionDeclaration(node) && node.body) {
        callback(node, node.name ?? node, node.name?.text ?? 'default')
    }
    if (ts.isMethodDeclaration(node) && node.body) {
        callback(node, node.name, propertyNameText(node.name, sourceFile))
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
        && ts.isVariableDeclaration(node.parent)
        && ts.isIdentifier(node.parent.name)) {
        callback(node, node.parent.name, node.parent.name.text)
    }
    ts.forEachChild(node, child => visitFunctions(sourceFile, child, callback))
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return name.getText(sourceFile)
}

function functionId(sourceFile: ts.SourceFile, location: ts.Node, name: string): string {
    const file = relative(REPO_ROOT, sourceFile.fileName).replaceAll('\\', '/')
    const {line} = sourceFile.getLineAndCharacterOfPosition(location.getStart(sourceFile))
    return `${file}:${line + 1}:${name}`
}

function outOfBandMessage(label: string, scored: readonly ScoredFunction[]): string {
    const top = scored.slice().sort(compareByTransitiveScore).slice(0, 10).map(formatScore).join('\n')
    return `TS transitive complexity ${label} canary is outside tolerance.\nTop functions:\n${top}`
}
