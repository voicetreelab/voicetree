import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')
const MAX_COGNITIVE_COMPLEXITY = 25
const HIGH_COMPLEXITY_THRESHOLD = 15
const BASELINE_COMPLEXITY_BUDGETS: ReadonlyMap<string, number> = new Map([
    ['packages/systems/agent-runtime/src/lifecycle/derive.ts::derive', 31],
    ['packages/systems/voicetree-mcp/src/spawnAgentTool.ts::spawnAgentTool', 64],
])

type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
}

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

async function discoverPackages(): Promise<PackageInfo[]> {
    const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
    const results = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return null
        const packageJsonPath = join(SYSTEMS_ROOT, entry.name, 'package.json')
        try {
            const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
            return {
                name: packageJson.name as string,
                dirName: entry.name,
                srcRoot: join(SYSTEMS_ROOT, entry.name, 'src'),
            }
        } catch {
            return null
        }
    }))
    return results.filter((p): p is PackageInfo => p !== null).sort((a, b) => a.dirName.localeCompare(b.dirName))
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function isProductionTypeScriptSource(path: string): boolean {
    return path.endsWith('.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.d.ts')
        && !path.includes('/__tests__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile() && isProductionTypeScriptSource(path)) return [path]
        return []
    }))
    return nested.flat().sort()
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression: ts.BinaryExpression): number {
    const operators: ts.SyntaxKind[] = []

    function collect(node: ts.Expression): void {
        if (!isLogicalExpression(node)) return
        collect(node.left)
        operators.push(node.operatorToken.kind)
        collect(node.right)
    }

    collect(expression)
    if (operators.length === 0) return 0

    let chains = 1
    for (let i = 1; i < operators.length; i += 1) {
        if (operators[i] !== operators[i - 1]) chains += 1
    }
    return chains
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

function isDirectRecursiveCall(node: ts.CallExpression, name: string): boolean {
    if (name === '<anonymous>' || name === 'constructor') return false
    if (ts.isIdentifier(node.expression)) return node.expression.text === name
    if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text === name
    return false
}

function scoreFunction(root: ts.FunctionLikeDeclaration, name: string, sourceFile: ts.SourceFile): number {
    let score = 0

    function addStructural(nesting: number): void {
        score += 1 + nesting
    }

    function visitIfStatement(node: ts.IfStatement, nesting: number, isElseIf: boolean): void {
        if (isElseIf) score += 1
        else addStructural(nesting)

        visit(node.expression, nesting)
        visit(node.thenStatement, nesting + 1)

        if (!node.elseStatement) return
        if (ts.isIfStatement(node.elseStatement)) {
            visitIfStatement(node.elseStatement, nesting, true)
            return
        }

        score += 1
        visit(node.elseStatement, nesting + 1)
    }

    function visit(node: ts.Node, nesting: number): void {
        if (node !== root && isFunctionLikeBoundary(node)) return

        if (ts.isIfStatement(node)) {
            visitIfStatement(node, nesting, false)
            return
        }

        if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }

        if (ts.isSwitchStatement(node)) {
            for (const clause of node.caseBlock.clauses) {
                if (ts.isCaseClause(clause)) score += 1 + nesting
                ts.forEachChild(clause, child => visit(child, nesting + 1))
            }
            return
        }

        if (ts.isCatchClause(node)) {
            addStructural(nesting)
            visit(node.block, nesting + 1)
            return
        }

        if (ts.isConditionalExpression(node)) {
            addStructural(nesting)
            ts.forEachChild(node, child => visit(child, nesting + 1))
            return
        }

        if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) {
            score += 1
        }

        if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) {
            score += 1
        }

        if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) {
            score += countLogicalOperatorChains(node)
        }

        ts.forEachChild(node, child => visit(child, nesting))
    }

    visit(root, 0)
    return score
}

function findFunctionComplexities(packageName: string, file: string, text: string): FunctionComplexity[] {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const results: FunctionComplexity[] = []

    function visit(node: ts.Node): void {
        if (isFunctionLikeBoundary(node)) {
            const name = functionName(node, sourceFile)
            const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            results.push({
                packageName,
                file: relative(REPO_ROOT, file),
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

async function scanPackage(packageInfo: PackageInfo): Promise<FunctionComplexity[]> {
    const files = await listProductionSources(packageInfo.srcRoot)
    const nested = await Promise.all(files.map(async file => {
        const text = await readFile(file, 'utf8')
        return findFunctionComplexities(packageInfo.dirName, file, text)
    }))
    return nested.flat()
}

async function scanAllFunctions(): Promise<FunctionComplexity[]> {
    const packages = await discoverPackages()
    const nested = await Promise.all(packages.map(scanPackage))
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
    return violations
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

        expect(violations, formatViolations(violations)).toEqual([])
    })
})
