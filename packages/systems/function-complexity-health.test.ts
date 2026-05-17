import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from './discover-packages'
import {recordHealthMetric} from './_health-report-test-helpers'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
// Captured 2026-05-15 after widening discovery to whole repo via discoverPackages(); ratchet down over time.
const MAX_CYCLOMATIC_COMPLEXITY = 50   // observed max: 45 (graph-model/folderCollapse.ts:computeExpandPlan)
const MIN_MAINTAINABILITY_INDEX = 0    // observed min: 0 (graph-tools/collapseBoundary.ts); ratchet up
const MAX_CRAP_ZERO_COVERAGE = 2500    // observed max: 2070 (same offender as cyclomatic); ratchet down
const MAX_RUNTIME_FAN_IN = 110         // observed max: 107 (graph-model receives 107 named symbols)

type SourceFileInfo = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
}

type ImportDeclarationInfo = {
    readonly specifier: string
    readonly isTypeOnly: boolean
    readonly text: string
}

type FunctionComplexity = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly score: number
    readonly crapZeroCoverage: number
}

type MaintainabilityRow = {
    readonly file: string
    readonly sloc: number
    readonly vocabulary: number
    readonly length: number
    readonly volume: number
    readonly cyclomatic: number
    readonly maintainabilityIndex: number
}

type RuntimeFanInRow = {
    readonly packageName: string
    readonly runtimeSymbols: number
    readonly top: readonly string[]
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function isProductionSource(path: string): boolean {
    return path.endsWith('.ts')
        && !path.endsWith('/__audit_seed__.ts')
        && !path.endsWith('.test.ts')
        && !path.endsWith('.spec.ts')
        && !path.endsWith('.d.ts')
        && !path.includes('/__tests__/')
        && !path.includes('/__generated__/')
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile() && isProductionSource(path)) return [path]
        return []
    }))
    return nested.flat().sort()
}

async function discoverSourceFiles(packages: readonly PackageInfo[]): Promise<SourceFileInfo[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return files.map(file => ({
            absolutePath: resolve(file),
            relativePath: relative(REPO_ROOT, file),
            packageName: pkg.dirName,
        }))
    }))
    return nested.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function extractImportDeclarations(filePath: string, text: string): ImportDeclarationInfo[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const declarations: ImportDeclarationInfo[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                isTypeOnly: statement.importClause?.isTypeOnly ?? false,
                text: statement.getText(sourceFile),
            })
        }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                isTypeOnly: statement.isTypeOnly,
                text: statement.getText(sourceFile),
            })
        }
    }

    return declarations
}

function collectRuntimeSymbols(declaration: ImportDeclarationInfo): string[] {
    if (declaration.isTypeOnly) return []
    const match = declaration.text.match(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/)
    if (!match) return declaration.text.includes('* as ') ? ['*'] : []

    return match[1]
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => !part.startsWith('type '))
        .map(part => part.split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
}

async function buildRuntimeSymbolsByTarget(
    packages: readonly PackageInfo[],
    files: readonly SourceFileInfo[],
): Promise<Map<string, Map<string, Set<string>>>> {
    const runtimeSymbolsByTarget = new Map<string, Map<string, Set<string>>>()

    for (const fromFile of files) {
        const text = await readFile(fromFile.absolutePath, 'utf8')
        for (const declaration of extractImportDeclarations(fromFile.absolutePath, text)) {
            const targetPkg = packages.find(pkg => declaration.specifier === pkg.name || declaration.specifier.startsWith(`${pkg.name}/`))
            if (!targetPkg || targetPkg.dirName === fromFile.packageName) continue

            const targetSymbols = runtimeSymbolsByTarget.get(targetPkg.dirName) ?? new Map<string, Set<string>>()
            for (const symbol of collectRuntimeSymbols(declaration)) {
                const importers = targetSymbols.get(symbol) ?? new Set<string>()
                importers.add(fromFile.relativePath)
                targetSymbols.set(symbol, importers)
            }
            runtimeSymbolsByTarget.set(targetPkg.dirName, targetSymbols)
        }
    }

    return runtimeSymbolsByTarget
}

function runtimeFanInRows(runtimeSymbolsByTarget: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>): RuntimeFanInRow[] {
    return [...runtimeSymbolsByTarget.entries()].map(([packageName, symbols]) => ({
        packageName,
        runtimeSymbols: symbols.size,
        top: [...symbols.entries()]
            .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([symbol, files]) => `${symbol}(${files.size})`),
    })).sort((a, b) => b.runtimeSymbols - a.runtimeSymbols || a.packageName.localeCompare(b.packageName))
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
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

function cyclomaticIncrement(node: ts.Node): number {
    if (ts.isIfStatement(node)
        || ts.isForStatement(node)
        || ts.isForInStatement(node)
        || ts.isForOfStatement(node)
        || ts.isWhileStatement(node)
        || ts.isDoStatement(node)
        || ts.isCatchClause(node)
        || ts.isConditionalExpression(node)) {
        return 1
    }
    if (ts.isCaseClause(node)) return 1
    if (isLogicalExpression(node)) return 1
    return 0
}

function scoreCyclomaticComplexity(root: ts.FunctionLikeDeclaration): number {
    let score = 1
    function visit(node: ts.Node): void {
        if (node !== root && isFunctionLikeBoundary(node)) return
        score += cyclomaticIncrement(node)
        ts.forEachChild(node, visit)
    }
    visit(root)
    return score
}

async function measureCyclomaticComplexity(files: readonly SourceFileInfo[]): Promise<FunctionComplexity[]> {
    const nested = await Promise.all(files.map(async file => {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
        const rows: FunctionComplexity[] = []
        function visit(node: ts.Node): void {
            if (isFunctionLikeBoundary(node)) {
                const name = functionName(node, sourceFile)
                const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
                const score = scoreCyclomaticComplexity(node)
                rows.push({
                    packageName: file.packageName,
                    file: file.relativePath,
                    line: line + 1,
                    name,
                    score,
                    crapZeroCoverage: score * score + score,
                })
            }
            ts.forEachChild(node, visit)
        }
        ts.forEachChild(sourceFile, visit)
        return rows
    }))
    return nested.flat().sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
}

function sourceLinesOfCode(text: string): number {
    return text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
        .length
}

function isOperatorToken(kind: ts.SyntaxKind): boolean {
    return (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
        || (kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation)
}

function isOperandToken(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.Identifier
        || kind === ts.SyntaxKind.PrivateIdentifier
        || kind === ts.SyntaxKind.NumericLiteral
        || kind === ts.SyntaxKind.BigIntLiteral
        || kind === ts.SyntaxKind.StringLiteral
        || kind === ts.SyntaxKind.RegularExpressionLiteral
        || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
}

function measureHalstead(filePath: string, text: string, cyclomatic: number): MaintainabilityRow {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
    const operators = new Map<string, number>()
    const operands = new Map<string, number>()
    let token = scanner.scan()

    while (token !== ts.SyntaxKind.EndOfFileToken) {
        const value = scanner.getTokenText()
        if (isOperatorToken(token)) operators.set(value, (operators.get(value) ?? 0) + 1)
        if (isOperandToken(token)) operands.set(value, (operands.get(value) ?? 0) + 1)
        token = scanner.scan()
    }

    const vocabulary = operators.size + operands.size
    const length = [...operators.values()].reduce((sum, count) => sum + count, 0)
        + [...operands.values()].reduce((sum, count) => sum + count, 0)
    const volume = vocabulary === 0 || length === 0 ? 0 : length * Math.log2(vocabulary)
    const sloc = sourceLinesOfCode(text)
    const rawMaintainability = 171
        - 5.2 * Math.log(Math.max(1, volume))
        - 0.23 * cyclomatic
        - 16.2 * Math.log(Math.max(1, sloc))
    const maintainabilityIndex = Math.max(0, Math.min(100, (rawMaintainability * 100) / 171))

    return {
        file: relative(REPO_ROOT, filePath),
        sloc,
        vocabulary,
        length,
        volume,
        cyclomatic,
        maintainabilityIndex,
    }
}

async function measureMaintainability(
    files: readonly SourceFileInfo[],
    cyclomaticRows: readonly FunctionComplexity[],
): Promise<MaintainabilityRow[]> {
    const cyclomaticByFile = new Map<string, number>()
    for (const row of cyclomaticRows) {
        cyclomaticByFile.set(row.file, (cyclomaticByFile.get(row.file) ?? 0) + row.score)
    }

    const rows = await Promise.all(files.map(async file => {
        const text = await readFile(file.absolutePath, 'utf8')
        return measureHalstead(file.absolutePath, text, cyclomaticByFile.get(file.relativePath) ?? 1)
    }))
    return rows.sort((a, b) => a.maintainabilityIndex - b.maintainabilityIndex || a.file.localeCompare(b.file))
}

function formatFunctionRows(rows: readonly FunctionComplexity[]): string {
    return rows.slice(0, 10)
        .map(row => `${row.packageName} | ${row.file}:${row.line} | ${row.name} | cc=${row.score} | crap0=${row.crapZeroCoverage}`)
        .join('\n')
}

function formatMaintainabilityRows(rows: readonly MaintainabilityRow[]): string {
    return rows.slice(0, 10)
        .map(row => `${row.file} | MI=${row.maintainabilityIndex.toFixed(1)} | volume=${row.volume.toFixed(1)} | fileCC=${row.cyclomatic} | SLOC=${row.sloc}`)
        .join('\n')
}

describe('function complexity health', () => {
    it('keeps cyclomatic, maintainability, CRAP0, and runtime fan-in within budgets', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const cyclomatic = await measureCyclomaticComplexity(files)
        const maintainability = await measureMaintainability(files, cyclomatic)
        const runtimeSymbolsByTarget = await buildRuntimeSymbolsByTarget(packages, files)
        const runtimeFanIn = runtimeFanInRows(runtimeSymbolsByTarget)
        const maxCrapRows = [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage || a.file.localeCompare(b.file))

        const maxCyclomatic = cyclomatic[0]?.score ?? 0
        const minMaintainability = maintainability[0]?.maintainabilityIndex ?? 100
        const maxCrapZeroCoverage = maxCrapRows[0]?.crapZeroCoverage ?? 0
        const maxRuntimeFanIn = runtimeFanIn[0]?.runtimeSymbols ?? 0

        console.info(`\nTop cyclomatic offenders:\n${formatFunctionRows(cyclomatic)}`)
        console.info(`\nLowest maintainability files:\n${formatMaintainabilityRows(maintainability)}`)
        console.info(`\nRuntime fan-in:\n${runtimeFanIn.map(row => `${row.packageName} | ${row.runtimeSymbols} | ${row.top.join(', ')}`).join('\n')}`)

        await recordHealthMetric({
            metricId: 'function-cyclomatic-complexity',
            metricName: 'Function Cyclomatic Complexity',
            description: 'Maximum per-function cyclomatic complexity across discovered production packages.',
            category: 'Complexity',
            current: maxCyclomatic,
            budget: MAX_CYCLOMATIC_COMPLEXITY,
            comparison: 'lte',
            unit: 'branches',
            details: {topFunctions: cyclomatic.slice(0, 20), fileCount: files.length},
        })

        await recordHealthMetric({
            metricId: 'function-maintainability-index',
            metricName: 'Function Maintainability Index',
            description: 'Minimum Halstead maintainability index across discovered production source files.',
            category: 'Complexity',
            current: minMaintainability,
            budget: MIN_MAINTAINABILITY_INDEX,
            comparison: 'gte',
            unit: 'index',
            details: {lowestFiles: maintainability.slice(0, 20), fileCount: files.length},
        })

        await recordHealthMetric({
            metricId: 'function-crap0-risk',
            metricName: 'Function CRAP0 Risk',
            description: 'Maximum CRAP score estimate per function assuming zero coverage.',
            category: 'Complexity',
            current: maxCrapZeroCoverage,
            budget: MAX_CRAP_ZERO_COVERAGE,
            comparison: 'lte',
            unit: 'score',
            details: {topFunctions: maxCrapRows.slice(0, 20), fileCount: files.length},
        })

        await recordHealthMetric({
            metricId: 'runtime-fan-in',
            metricName: 'Runtime Fan-In',
            description: 'Maximum distinct runtime symbols imported from a package by other discovered packages.',
            category: 'Coupling',
            current: maxRuntimeFanIn,
            budget: MAX_RUNTIME_FAN_IN,
            comparison: 'lte',
            unit: 'symbols',
            details: {runtimeFanIn, fileCount: files.length},
        })

        expect.soft(maxCyclomatic).toBeLessThanOrEqual(MAX_CYCLOMATIC_COMPLEXITY)
        expect.soft(minMaintainability).toBeGreaterThanOrEqual(MIN_MAINTAINABILITY_INDEX)
        expect.soft(maxCrapZeroCoverage).toBeLessThanOrEqual(MAX_CRAP_ZERO_COVERAGE)
        expect.soft(maxRuntimeFanIn).toBeLessThanOrEqual(MAX_RUNTIME_FAN_IN)
    }, 60000)
})
