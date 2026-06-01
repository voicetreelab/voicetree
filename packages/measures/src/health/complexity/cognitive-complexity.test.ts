import {readFile} from 'node:fs/promises'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles, type SourceFileInfo} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {scoreFunction} from '../../_shared/complexity/cogcx-scorer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {maxCognitiveComplexity: MAX_COGNITIVE_COMPLEXITY, baselineComplexityBudgets: _baselineBudgetsRaw} =
    readBudgetSync<{maxCognitiveComplexity: number; baselineComplexityBudgets: Record<string, number>}>('complexity/cognitive-complexity.json')
const HIGH_COMPLEXITY_THRESHOLD = 15
const BASELINE_COMPLEXITY_BUDGETS: ReadonlyMap<string, number> = new Map(Object.entries(_baselineBudgetsRaw))


type FunctionComplexity = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly score: number
}

type PackageAggregate = {
    readonly packageName: string
    readonly average: number
    readonly max: number
    readonly highCount: number
    readonly functionCount: number
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return name.getText(sourceFile)
}

function functionName(node: ts.Node, sourceFile: ts.SourceFile): string {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text
    if (ts.isMethodDeclaration(node) && node.name) return propertyNameText(node.name, sourceFile)
    if (ts.isConstructorDeclaration(node)) return 'constructor'
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
        return propertyNameText(node.parent.name, sourceFile)
    }
    return '<anonymous>'
}

function isFunctionLikeBoundary(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
}

function findFunctionComplexities(sf: SourceFileInfo, text: string): FunctionComplexity[] {
    const sourceFile = ts.createSourceFile(sf.absolutePath, text, ts.ScriptTarget.Latest, true)
    const results: FunctionComplexity[] = []

    function visit(node: ts.Node): void {
        if (isFunctionLikeBoundary(node)) {
            const name = functionName(node, sourceFile)
            const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.push({
                packageName: sf.packageName,
                file: sf.relativePath,
                line: line + 1,
                name,
                score: scoreFunction(node, name, sourceFile),
            })
        }

        ts.forEachChild(node, visit)
    }

    ts.forEachChild(sourceFile, visit)
    return results
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error
}

async function scanAllFunctions(): Promise<FunctionComplexity[]> {
    const packages = await discoverPackages()
    const sourceFiles = await discoverSourceFiles(packages, REPO_ROOT)
    const nested = await Promise.all(sourceFiles.map(async sf => {
        try {
            const text = await readFile(sf.absolutePath, 'utf8')
            return findFunctionComplexities(sf, text)
        } catch (error) {
            if (isErrnoException(error) && error.code === 'ENOENT') return []
            throw error
        }
    }))
    return nested.flat()
}

function compareByComplexity(a: FunctionComplexity, b: FunctionComplexity): number {
    return b.score - a.score
        || a.packageName.localeCompare(b.packageName)
        || a.file.localeCompare(b.file)
        || a.line - b.line
        || a.name.localeCompare(b.name)
}

function packageAggregates(functions: readonly FunctionComplexity[]): PackageAggregate[] {
    const byPackage = new Map<string, FunctionComplexity[]>()
    for (const fn of functions) {
        const list = byPackage.get(fn.packageName)
        if (list) list.push(fn)
        else byPackage.set(fn.packageName, [fn])
    }

    return [...byPackage].sort(([a], [b]) => a.localeCompare(b)).map(([packageName, packageFunctions]) => {
        const total = packageFunctions.reduce((sum, fn) => sum + fn.score, 0)
        return {
            packageName,
            average: packageFunctions.length === 0 ? 0 : total / packageFunctions.length,
            max: Math.max(0, ...packageFunctions.map(fn => fn.score)),
            highCount: packageFunctions.filter(fn => fn.score > HIGH_COMPLEXITY_THRESHOLD).length,
            functionCount: packageFunctions.length,
        }
    })
}

function formatTopFunctions(functions: readonly FunctionComplexity[]): string {
    const lines = [
        '',
        'Top 20 cognitive complexity scores:',
        'Package | File | Function | Cognitive Complexity',
        '--- | --- | --- | ---',
    ]
    for (const fn of [...functions].sort(compareByComplexity).slice(0, 20)) {
        lines.push(`${fn.packageName} | ${fn.file}:${fn.line} | ${fn.name} | ${fn.score}`)
    }
    return lines.join('\n')
}

function formatPackageAggregates(aggregates: readonly PackageAggregate[]): string {
    const lines = [
        '',
        'Per-package cognitive complexity:',
        'Package | Avg Complexity | Max Complexity | Functions > 15 | Function Count',
        '--- | --- | --- | --- | ---',
    ]
    for (const aggregate of aggregates) {
        lines.push(`${aggregate.packageName} | ${aggregate.average.toFixed(2)} | ${aggregate.max} | ${aggregate.highCount} | ${aggregate.functionCount}`)
    }
    return lines.join('\n')
}

function formatViolations(violations: readonly FunctionComplexity[]): string {
    if (violations.length === 0) return 'No functions exceed cognitive complexity threshold.'
    return [...violations]
        .sort(compareByComplexity)
        .map(fn => `${fn.packageName} | ${fn.file}:${fn.line} | ${fn.name} | ${fn.score}`)
        .join('\n')
}

function complexityBudgetFor(fn: FunctionComplexity): number {
    return BASELINE_COMPLEXITY_BUDGETS.get(`${fn.file}::${fn.name}`) ?? MAX_COGNITIVE_COMPLEXITY
}

describe('systems cognitive complexity', () => {
    it('keeps function cognitive complexity below the threshold', async () => {
        const functions = await scanAllFunctions()
        const aggregates = packageAggregates(functions)
        const violations = functions.filter(fn => fn.score > complexityBudgetFor(fn))

        console.info(formatTopFunctions(functions))
        console.info(formatPackageAggregates(aggregates))
        console.info(formatViolations(violations))

        const maxBudgetRatio = functions.reduce((max, fn) => {
            const budget = complexityBudgetFor(fn)
            return Math.max(max, budget === 0 ? 0 : fn.score / budget)
        }, 0)
        const maxScore = functions.reduce((max, fn) => Math.max(max, fn.score), 0)

        await recordHealthMetric({
            metricId: 'cognitive-complexity',
            metricName: 'Cognitive Complexity',
            description: 'Maximum per-function cognitive-complexity budget usage across systems packages.',
            category: 'Complexity',
            current: maxBudgetRatio,
            budget: 1,
            comparison: 'lte',
            unit: 'budget ratio',
            details: {
                maxScore,
                defaultBudget: MAX_COGNITIVE_COMPLEXITY,
                highComplexityThreshold: HIGH_COMPLEXITY_THRESHOLD,
                violations,
                aggregates,
                topFunctions: functions.slice().sort(compareByComplexity).slice(0, 20),
            },
        })

        expect(violations, formatViolations(violations)).toEqual([])
    })
})
