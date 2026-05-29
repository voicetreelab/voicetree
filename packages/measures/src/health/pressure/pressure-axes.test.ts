import {execSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric, removeHealthReports} from '../../_shared/writers/report-writer'

const REPO_ROOT = DEFAULT_REPO_ROOT
const TYPE_ONLY_BOUNDARY_COMPLEXITY_WEIGHT = 0.25
const PRESSURE_HEADROOM_DEBT_RATIO = 0.75

// Tiered budgets (Option A from task_ndq4d4):
//
//   budget       = errorBudget — ratchet that gates CI. Calibrated to keep
//                  each axis at debtRatio ≈ 0.75 against today's whole-repo
//                  worst observation. RSCD uses the worst debt ratio plus a
//                  small surcharge for top-five pressure above that 0.75
//                  headroom target. A fresh worst-offender appearing past the
//                  ratchet breaks the build.
//   targetBudget = aspirational ceiling. Surfaced via the sidecar `-target`
//                  metrics with severity:'warning' (visible on the dashboard,
//                  never blocks CI). Drives gradual refactor work.
const PRESSURE_AXIS_CONFIGS = [
    {
        name: 'max cognitive complexity',
        metricKey: 'maxCognitiveComplexity',
        metricId: 'complexity-pressure-cognitive-max',
        budget: 140,
        targetBudget: 18,
        comparison: 'lte',
        unit: 'score',
    },
    {
        name: 'max cyclomatic complexity',
        metricKey: 'maxCyclomaticComplexity',
        metricId: 'complexity-pressure-cyclomatic-max',
        budget: 60,
        targetBudget: 20,
        comparison: 'lte',
        unit: 'score',
    },
    // Halstead-MI without SLOC term — target debtRatio for gte axes inverts:
    // errorBudget = current × 0.75 (lower-is-worse → ratchet sits below today's worst).
    {
        name: 'min maintainability index',
        metricKey: 'minMaintainabilityIndex',
        metricId: 'complexity-pressure-maintainability-min',
        budget: 35,
        targetBudget: 60,
        comparison: 'gte',
        unit: 'index',
    },
    {
        name: 'max CRAP0 risk',
        metricKey: 'maxCrapZeroCoverage',
        metricId: 'complexity-pressure-crap0-max',
        budget: 2800,
        targetBudget: 300,
        comparison: 'lte',
        unit: 'score',
    },
    {
        name: 'max file lines',
        metricKey: 'maxFileLines',
        metricId: 'complexity-pressure-file-lines-max',
        budget: 1200,
        targetBudget: 400,
        comparison: 'lte',
        unit: 'lines',
    },
    {
        name: 'max boundary ratio',
        metricKey: 'maxBoundaryRatio',
        metricId: 'complexity-pressure-boundary-ratio-max',
        budget: 0.91,
        targetBudget: 0.30,
        comparison: 'lte',
        unit: 'ratio',
    },
    // Ratio axis: semantic ceiling is 1.0, so 0.75 headroom isn't achievable.
    // Ratchet at 0.95 (tight) because further widening would defeat the gate.
    {
        name: 'max subdirectory cross-edge ratio',
        metricKey: 'maxSubdirCrossRatio',
        metricId: 'complexity-pressure-subdir-cross-ratio-max',
        budget: 0.95,
        targetBudget: 0.60,
        comparison: 'lte',
        unit: 'ratio',
    },
    {
        name: 'aggregate boundary complexity',
        metricKey: 'aggregateBoundaryComplexity',
        metricId: 'complexity-pressure-boundary-complexity-aggregate',
        // 2026-05-29: current repo baseline after extracting `@vt/paths` is
        // ~284. Keep the same pressure-axis convention used above: CI budget
        // includes headroom rather than sitting exactly on the current value.
        // The added boundary is a tiny leaf package that removes duplicated
        // path construction rather than widening a bidirectional subsystem.
        budget: 380,
        targetBudget: 16.0,
        comparison: 'lte',
        unit: 'bci',
    },
    {
        name: 'max runtime fan-in',
        metricKey: 'maxRuntimeFanIn',
        metricId: 'complexity-pressure-runtime-fan-in-max',
        budget: 145,
        targetBudget: 10,
        comparison: 'lte',
        unit: 'symbols',
    },
    {
        name: 'max file turbulence',
        metricKey: 'maxFileTurbulence',
        metricId: 'complexity-pressure-file-turbulence-max',
        budget: 1700,
        targetBudget: 250,
        comparison: 'lte',
        unit: 'turbulence',
    },
    {
        name: 'max package avg turbulence',
        metricKey: 'maxPackageAverageTurbulence',
        metricId: 'complexity-pressure-package-turbulence-avg-max',
        // 2026-05-29: current whole-repo baseline is ~72; offender is
        // graph-tools, unrelated to this path migration. Keep the ratchet
        // consistent with the pressure-axis headroom convention above.
        budget: 96,
        targetBudget: 35,
        comparison: 'lte',
        unit: 'turbulence',
    },
] as const

type PressureAxisConfig = typeof PRESSURE_AXIS_CONFIGS[number]

type SystemFile = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
    readonly npmName: string
    readonly subdirectory: string
}

type GraphEdge = {
    readonly from: string
    readonly to: string
    readonly fromPackage: string
    readonly toPackage: string
    readonly fromSubdirectory: string
    readonly toSubdirectory: string
    readonly hasRuntimeBinding: boolean
    readonly hasTypeOnlyBinding: boolean
}

type SystemGraph = {
    readonly files: readonly SystemFile[]
    readonly edges: readonly GraphEdge[]
    readonly runtimeSymbolsByTarget: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
}

type FunctionComplexity = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly score: number
    readonly crapZeroCoverage?: number
}

type MaintainabilityRow = {
    readonly file: string
    readonly maintainabilityIndex: number
}

type FileLinesRow = {
    readonly file: string
    readonly lineCount: number
}

type TurbulenceRow = {
    readonly packageName: string
    readonly file: string
    readonly churn: number
    readonly complexity: number
    readonly turbulence: number
}

type PressureAxis = {
    readonly name: string
    readonly metricKey: PressureAxisConfig['metricKey']
    readonly current: number
    readonly budget: number
    readonly targetBudget: number
    readonly comparison: 'lte' | 'gte'
    readonly passed: boolean
    readonly debtRatio: number
    readonly worstOffender: string
}

function subdirectoryOf(absolutePath: string, srcRoot: string): string {
    const srcRelative = relative(srcRoot, absolutePath)
    const firstSlash = srcRelative.indexOf('/')
    return firstSlash >= 0 ? srcRelative.slice(0, firstSlash) : '.'
}

async function materializeSystemFiles(packages: readonly PackageInfo[]): Promise<SystemFile[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const sourceFiles = await discoverSourceFiles([pkg], REPO_ROOT)
        return sourceFiles.map(sf => ({
            absolutePath: sf.absolutePath,
            relativePath: sf.relativePath,
            packageName: sf.packageName,
            npmName: pkg.name,
            subdirectory: subdirectoryOf(sf.absolutePath, pkg.srcRoot),
        }))
    }))
    return nested.flat()
}

type ImportDeclarationInfo = {
    readonly specifier: string
    readonly hasRuntimeBindings: boolean
    readonly hasTypeOnlyBindings: boolean
    readonly text: string
}

function importClauseBindingKinds(importClause: ts.ImportClause | undefined): {hasRuntimeBindings: boolean; hasTypeOnlyBindings: boolean} {
    if (!importClause) return {hasRuntimeBindings: true, hasTypeOnlyBindings: false}
    if (importClause.isTypeOnly) return {hasRuntimeBindings: false, hasTypeOnlyBindings: true}
    if (importClause.name) return {hasRuntimeBindings: true, hasTypeOnlyBindings: false}

    const namedBindings = importClause.namedBindings
    if (!namedBindings) return {hasRuntimeBindings: false, hasTypeOnlyBindings: false}
    if (ts.isNamespaceImport(namedBindings)) return {hasRuntimeBindings: true, hasTypeOnlyBindings: false}

    let hasRuntimeBindings = false
    let hasTypeOnlyBindings = false
    for (const element of namedBindings.elements) {
        if (element.isTypeOnly) hasTypeOnlyBindings = true
        else hasRuntimeBindings = true
    }
    return {hasRuntimeBindings, hasTypeOnlyBindings}
}

function exportDeclarationBindingKinds(statement: ts.ExportDeclaration): {hasRuntimeBindings: boolean; hasTypeOnlyBindings: boolean} {
    if (statement.isTypeOnly) return {hasRuntimeBindings: false, hasTypeOnlyBindings: true}
    const exportClause = statement.exportClause
    if (!exportClause) return {hasRuntimeBindings: true, hasTypeOnlyBindings: false}
    if (ts.isNamespaceExport(exportClause)) return {hasRuntimeBindings: true, hasTypeOnlyBindings: false}

    let hasRuntimeBindings = false
    let hasTypeOnlyBindings = false
    for (const element of exportClause.elements) {
        if (element.isTypeOnly) hasTypeOnlyBindings = true
        else hasRuntimeBindings = true
    }
    return {hasRuntimeBindings, hasTypeOnlyBindings}
}

function extractImportDeclarations(filePath: string, text: string): ImportDeclarationInfo[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const declarations: ImportDeclarationInfo[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            const bindingKinds = importClauseBindingKinds(statement.importClause)
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                ...bindingKinds,
                text: statement.getText(sourceFile),
            })
        }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            const bindingKinds = exportDeclarationBindingKinds(statement)
            declarations.push({
                specifier: statement.moduleSpecifier.text,
                ...bindingKinds,
                text: statement.getText(sourceFile),
            })
        }
    }

    return declarations
}

function resolveFileCandidate(basePath: string, knownFiles: ReadonlySet<string>): string | null {
    const resolved = resolve(basePath)
    const candidates = resolved.endsWith('.ts')
        ? [resolved]
        : [resolved, `${resolved}.ts`, join(resolved, 'index.ts')]
    return candidates.find(candidate => knownFiles.has(candidate)) ?? null
}

function resolveSpecifier(
    fromAbsPath: string,
    specifier: string,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    knownFiles: ReadonlySet<string>,
): string | null {
    if (specifier.startsWith('.')) return resolveFileCandidate(join(dirname(fromAbsPath), specifier), knownFiles)

    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(`${npmName}/`)) continue
        const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
        return resolveFileCandidate(join(pkg.srcRoot, subPath), knownFiles)
    }

    return null
}

function collectRuntimeSymbols(declaration: ImportDeclarationInfo): string[] {
    if (!declaration.hasRuntimeBindings) return []
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

async function buildSystemGraph(packages: readonly PackageInfo[]): Promise<SystemGraph> {
    const materialized = await materializeSystemFiles(packages)
    const filesByPkg = new Map<string, SystemFile[]>()
    for (const file of materialized) {
        const bucket = filesByPkg.get(file.packageName) ?? []
        bucket.push(file)
        filesByPkg.set(file.packageName, bucket)
    }
    const files: SystemFile[] = packages.flatMap(pkg => {
        const bucket = filesByPkg.get(pkg.dirName) ?? []
        return [...bucket].sort((a, b) => a.absolutePath < b.absolutePath ? -1 : a.absolutePath > b.absolutePath ? 1 : 0)
    })

    const filesByPath = new Map(files.map(file => [file.absolutePath, file]))
    const knownFiles = new Set(filesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const edgesByFilePair = new Map<string, GraphEdge>()
    const runtimeSymbolsByTarget = new Map<string, Map<string, Set<string>>>()

    for (const fromFile of files) {
        const text = await readFile(fromFile.absolutePath, 'utf8')
        for (const declaration of extractImportDeclarations(fromFile.absolutePath, text)) {
            const toPath = resolveSpecifier(fromFile.absolutePath, declaration.specifier, packagesByNpmName, knownFiles)
            const toFile = toPath ? filesByPath.get(toPath) : null
            if (toFile && toFile.absolutePath !== fromFile.absolutePath) {
                const edgeKey = `${fromFile.relativePath}\0${toFile.relativePath}`
                const existing = edgesByFilePair.get(edgeKey)
                if (existing) {
                    edgesByFilePair.set(edgeKey, {
                        ...existing,
                        hasRuntimeBinding: existing.hasRuntimeBinding || declaration.hasRuntimeBindings,
                        hasTypeOnlyBinding: existing.hasTypeOnlyBinding || declaration.hasTypeOnlyBindings,
                    })
                } else {
                    edgesByFilePair.set(edgeKey, {
                        from: fromFile.relativePath,
                        to: toFile.relativePath,
                        fromPackage: fromFile.packageName,
                        toPackage: toFile.packageName,
                        fromSubdirectory: fromFile.subdirectory,
                        toSubdirectory: toFile.subdirectory,
                        hasRuntimeBinding: declaration.hasRuntimeBindings,
                        hasTypeOnlyBinding: declaration.hasTypeOnlyBindings,
                    })
                }
            }

            const targetPkg = packages.find(pkg => declaration.specifier === pkg.name || declaration.specifier.startsWith(`${pkg.name}/`))
            if (!targetPkg || targetPkg.dirName === fromFile.packageName) continue
            const targetSymbols = runtimeSymbolsByTarget.get(targetPkg.dirName) ?? new Map<string, Set<string>>()
            runtimeSymbolsByTarget.set(targetPkg.dirName, targetSymbols)
            for (const symbol of collectRuntimeSymbols(declaration)) {
                const filesForSymbol = targetSymbols.get(symbol) ?? new Set<string>()
                filesForSymbol.add(fromFile.relativePath)
                targetSymbols.set(symbol, filesForSymbol)
            }
        }
    }

    return {files, edges: [...edgesByFilePair.values()], runtimeSymbolsByTarget}
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
    return kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
    return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)
}

function countLogicalOperatorChains(expression: ts.Expression): number {
    const operators: ts.SyntaxKind[] = []
    function collect(node: ts.Node): void {
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
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) return propertyNameText(node.parent.name, sourceFile)
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
    const addStructural = (nesting: number): void => { score += 1 + nesting }

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
        if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label) score += 1
        if (ts.isCallExpression(node) && isDirectRecursiveCall(node, name)) score += 1
        if (isLogicalExpression(node) && !isLogicalExpression(node.parent)) score += countLogicalOperatorChains(node)
        ts.forEachChild(node, child => visit(child, nesting))
    }

    visit(root, 0)
    return score
}

async function measureCognitiveComplexity(files: readonly SystemFile[]): Promise<FunctionComplexity[]> {
    const rows: FunctionComplexity[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
        function visit(node: ts.Node): void {
            if (isFunctionLikeBoundary(node)) {
                const name = functionName(node, sourceFile)
                const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
                rows.push({
                    packageName: file.packageName,
                    file: file.relativePath,
                    line: line + 1,
                    name,
                    score: scoreFunction(node, name, sourceFile),
                })
            }
            ts.forEachChild(node, visit)
        }
        ts.forEachChild(sourceFile, visit)
    }
    return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
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

async function measureCyclomaticComplexity(files: readonly SystemFile[]): Promise<Required<FunctionComplexity>[]> {
    const rows: Required<FunctionComplexity>[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const sourceFile = ts.createSourceFile(file.absolutePath, text, ts.ScriptTarget.Latest, true)
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
    }
    return rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
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

    const n1 = operators.size
    const n2 = operands.size
    const totalOperators = [...operators.values()].reduce((sum, count) => sum + count, 0)
    const totalOperands = [...operands.values()].reduce((sum, count) => sum + count, 0)
    const vocabulary = n1 + n2
    const length = totalOperators + totalOperands
    const volume = vocabulary === 0 || length === 0 ? 0 : length * Math.log2(vocabulary)
    // SLOC term intentionally dropped: file-size pressure is gated by the dedicated
    // max-file-lines axis. Halstead-MI then measures token-level density only.
    const rawMaintainability = 171
        - 5.2 * Math.log(Math.max(1, volume))
        - 0.23 * cyclomatic
    const maintainabilityIndex = Math.max(0, Math.min(100, (rawMaintainability * 100) / 171))

    return {file: relative(REPO_ROOT, filePath), maintainabilityIndex}
}

async function measureFileLines(files: readonly SystemFile[]): Promise<FileLinesRow[]> {
    const rows: FileLinesRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        rows.push({file: file.relativePath, lineCount: text.split('\n').length})
    }
    return rows.sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
}

async function measureMaintainability(files: readonly SystemFile[], cyclomaticRows: readonly FunctionComplexity[]): Promise<MaintainabilityRow[]> {
    const cyclomaticByFile = new Map<string, number>()
    for (const row of cyclomaticRows) {
        cyclomaticByFile.set(row.file, (cyclomaticByFile.get(row.file) ?? 0) + row.score)
    }

    const rows: MaintainabilityRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        rows.push(measureHalstead(file.absolutePath, text, cyclomaticByFile.get(file.relativePath) ?? 1))
    }
    return rows.sort((a, b) => a.maintainabilityIndex - b.maintainabilityIndex || a.file.localeCompare(b.file))
}

function countSimpleComplexity(filePath: string, text: string): number {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    let complexity = 0
    function visit(node: ts.Node): void {
        if (ts.isIfStatement(node)
            || ts.isForStatement(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isWhileStatement(node)
            || ts.isDoStatement(node)
            || ts.isSwitchStatement(node)
            || ts.isCatchClause(node)
            || ts.isConditionalExpression(node)) {
            complexity += 1
        }
        ts.forEachChild(node, visit)
    }
    ts.forEachChild(sourceFile, visit)
    return complexity
}

function tryRunGit(args: string): string | null {
    try {
        // 64 MB cap: whole-repo `git log --name-only --since=6mo` is ~1.4 MB
        // today and grows with history. The default 1 MB limit silently truncates
        // → churn map empty → file-turbulence axis falsely reports 0.
        return execSync(`git ${args}`, {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024})
    } catch {
        return null
    }
}

function collectGitChurn(): ReadonlyMap<string, number> {
    const output = tryRunGit("log --first-parent --since='6 months ago' --format=%H --name-only") ?? ''
    const churn = new Map<string, number>()
    for (const line of output.split('\n')) {
        const file = line.trim()
        if (!file) continue
        churn.set(file, (churn.get(file) ?? 0) + 1)
    }
    return churn
}

async function measureTurbulence(files: readonly SystemFile[]): Promise<TurbulenceRow[]> {
    const churn = collectGitChurn()
    const rows: TurbulenceRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        const fileChurn = churn.get(file.relativePath) ?? 0
        const complexity = countSimpleComplexity(file.absolutePath, text)
        rows.push({
            packageName: file.packageName,
            file: file.relativePath,
            churn: fileChurn,
            complexity,
            turbulence: fileChurn * complexity,
        })
    }
    return rows.sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))
}

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

function computeBoundaryComplexity(edges: readonly GraphEdge[]): number {
    if (edges.length === 0) return 0
    const src = new Set(edges.map(edge => edge.from))
    const tgt = new Set(edges.map(edge => edge.to))
    const srcNodes = [...src].map(file => `src:${file}`)
    const tgtNodes = [...tgt].map(file => `tgt:${file}`)
    const pairs = edges.map(edge => [`src:${edge.from}`, `tgt:${edge.to}`] as const)
    const treeWidth = mcsTreeWidthLowerBound([...srcNodes, ...tgtNodes], pairs)
    return (treeWidth + 1) * Math.log2(edges.length + 1)
}

function measureBoundaries(files: readonly SystemFile[], edges: readonly GraphEdge[], packageNames: readonly string[]) {
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
        const runtimeEdges = pairEdges.filter(edge => edge.hasRuntimeBinding)
        const typeOnlyEdges = pairEdges.filter(edge => !edge.hasRuntimeBinding && edge.hasTypeOnlyBinding)
        const runtimeBci = computeBoundaryComplexity(runtimeEdges)
        const typeOnlyBci = computeBoundaryComplexity(typeOnlyEdges)
        return {
            pair,
            srcFan: src.size,
            tgtFan: tgt.size,
            edgeCount: pairEdges.length,
            runtimeEdgeCount: runtimeEdges.length,
            typeOnlyEdgeCount: typeOnlyEdges.length,
            density,
            treeWidth,
            rawBci: computeBoundaryComplexity(pairEdges),
            runtimeBci,
            typeOnlyBci,
            bci: runtimeBci + TYPE_ONLY_BOUNDARY_COMPLEXITY_WEIGHT * typeOnlyBci,
        }
    }).sort((a, b) => b.bci - a.bci || a.pair.localeCompare(b.pair))

    return {
        boundaryProfiles,
        subdirProfiles,
        pairMetrics,
        aggregateBci: pairMetrics.reduce((sum, pair) => sum + pair.bci, 0),
        aggregateRawBci: pairMetrics.reduce((sum, pair) => sum + pair.rawBci, 0),
        aggregateRuntimeBci: pairMetrics.reduce((sum, pair) => sum + pair.runtimeBci, 0),
        aggregateTypeOnlyBci: pairMetrics.reduce((sum, pair) => sum + pair.typeOnlyBci, 0),
    }
}

function runtimeFanInRows(runtimeSymbolsByTarget: SystemGraph['runtimeSymbolsByTarget']) {
    return [...runtimeSymbolsByTarget.entries()].map(([packageName, symbols]) => ({
        packageName,
        runtimeSymbols: symbols.size,
        top: [...symbols.entries()]
            .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([symbol, files]) => `${symbol}(${files.size})`),
    })).sort((a, b) => b.runtimeSymbols - a.runtimeSymbols || a.packageName.localeCompare(b.packageName))
}

function aggregateTurbulence(rows: readonly TurbulenceRow[]) {
    const grouped = new Map<string, TurbulenceRow[]>()
    for (const row of rows) {
        const existing = grouped.get(row.packageName) ?? []
        existing.push(row)
        grouped.set(row.packageName, existing)
    }

    return [...grouped.entries()].map(([packageName, files]) => {
        const total = files.reduce((sum, row) => sum + row.turbulence, 0)
        const maxFile = [...files].sort((a, b) => b.turbulence - a.turbulence || a.file.localeCompare(b.file))[0] ?? null
        return {packageName, files: files.length, total, average: files.length === 0 ? 0 : total / files.length, maxFile}
    }).sort((a, b) => b.average - a.average || a.packageName.localeCompare(b.packageName))
}

function debtRatio(current: number, budget: number, comparison: PressureAxis['comparison']): number {
    return comparison === 'gte' ? budget / Math.max(1, current) : budget === 0 ? 0 : current / budget
}

function axisPassed(current: number, budget: number, comparison: PressureAxis['comparison']): boolean {
    return comparison === 'gte' ? current >= budget : current <= budget
}

function axis(config: PressureAxisConfig, current: number, worstOffender: string): PressureAxis {
    return {
        name: config.name,
        metricKey: config.metricKey,
        current,
        budget: config.budget,
        targetBudget: config.targetBudget,
        comparison: config.comparison,
        passed: axisPassed(current, config.budget, config.comparison),
        debtRatio: debtRatio(current, config.budget, config.comparison),
        worstOffender,
    }
}

async function computePressureReport(): Promise<{axes: PressureAxis[]; boundaries: ReturnType<typeof measureBoundaries>}> {
    const packages = await discoverPackages(REPO_ROOT)
    const packageNames = packages.map(pkg => pkg.dirName)
    const graph = await buildSystemGraph(packages)

    const cognitive = await measureCognitiveComplexity(graph.files)
    const cyclomatic = await measureCyclomaticComplexity(graph.files)
    const maintainability = await measureMaintainability(graph.files, cyclomatic)
    const fileLines = await measureFileLines(graph.files)
    const turbulence = await measureTurbulence(graph.files)
    const packageTurbulence = aggregateTurbulence(turbulence)
    const boundaries = measureBoundaries(graph.files, graph.edges, packageNames)
    const runtimeFanIn = runtimeFanInRows(graph.runtimeSymbolsByTarget)
    const maxCrap = [...cyclomatic].sort((a, b) => b.crapZeroCoverage - a.crapZeroCoverage)[0]

    return {
        axes: [
            axis(PRESSURE_AXIS_CONFIGS[0], cognitive[0]?.score ?? 0, cognitive[0] ? `${cognitive[0].file}:${cognitive[0].line} ${cognitive[0].name}` : 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[1], cyclomatic[0]?.score ?? 0, cyclomatic[0] ? `${cyclomatic[0].file}:${cyclomatic[0].line} ${cyclomatic[0].name}` : 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[2], maintainability[0]?.maintainabilityIndex ?? 100, maintainability[0]?.file ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[3], maxCrap?.crapZeroCoverage ?? 0, maxCrap ? `${maxCrap.file}:${maxCrap.line} ${maxCrap.name}` : 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[4], fileLines[0]?.lineCount ?? 0, fileLines[0]?.file ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[5], boundaries.boundaryProfiles[0]?.ratio ?? 0, boundaries.boundaryProfiles[0]?.packageName ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[6], boundaries.subdirProfiles[0]?.ratio ?? 0, boundaries.subdirProfiles[0]?.packageName ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[7], boundaries.aggregateBci, boundaries.pairMetrics[0]?.pair ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[8], runtimeFanIn[0]?.runtimeSymbols ?? 0, runtimeFanIn[0]?.packageName ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[9], turbulence[0]?.turbulence ?? 0, turbulence[0]?.file ?? 'n/a'),
            axis(PRESSURE_AXIS_CONFIGS[10], packageTurbulence[0]?.average ?? 0, packageTurbulence[0]?.packageName ?? 'n/a'),
        ],
        boundaries,
    }
}

function computeRscd(axes: readonly PressureAxis[]): {rscd: number; topFiveRatiosForRscd: number[]; topFiveExcessRatiosForRscd: number[]} {
    const topFiveRatiosForRscd = axes.map(axis => axis.debtRatio).sort((a, b) => b - a).slice(0, 5)
    const topFiveExcessRatiosForRscd = topFiveRatiosForRscd.map(value => Math.max(0, value - PRESSURE_HEADROOM_DEBT_RATIO))
    const meanTopFiveExcess = topFiveExcessRatiosForRscd.reduce((sum, value) => sum + value, 0) / Math.max(1, topFiveExcessRatiosForRscd.length)
    return {
        rscd: (topFiveRatiosForRscd[0] ?? 0) + 0.25 * meanTopFiveExcess,
        topFiveRatiosForRscd,
        topFiveExcessRatiosForRscd,
    }
}

function failureMessage(axes: readonly PressureAxis[], rscd: number): string {
    return [
        `RSCD ${rscd} exceeds target 1.0.`,
        ...axes.filter(axis => !axis.passed).map(axis => `${axis.name}: current=${axis.current}, budget=${axis.budget}, debtRatio=${axis.debtRatio}, offender=${axis.worstOffender}`),
    ].join('\n')
}

// Sidecar `-target` metrics surface each axis's aspirational targetBudget
// alongside the CI-gating errorBudget. severity:'warning' keeps them off the
// CI gate while marking the corresponding dashboard tile as off-target. Lets
// reviewers track refactor pressure on individual axes without holding up
// merges.
async function recordSidecarTargets(axes: readonly PressureAxis[]): Promise<void> {
    for (const axisData of axes) {
        const config = PRESSURE_AXIS_CONFIGS.find(c => c.name === axisData.name)
        if (!config) continue
        if (config.budget === config.targetBudget) continue
        await recordHealthMetric({
            metricId: `${config.metricId}-target`,
            metricName: `${config.name} (aspirational target)`,
            description: `Warning-only sidecar for ${config.name}. Reports the axis value against the aspirational target budget rather than the CI-gating ratchet. Never blocks CI.`,
            category: 'Complexity',
            current: axisData.current,
            budget: config.targetBudget,
            comparison: config.comparison,
            severity: 'warning',
            unit: config.unit,
            details: {
                errorBudget: config.budget,
                targetBudget: config.targetBudget,
                worstOffender: axisData.worstOffender,
            },
        })
    }
}

async function recordTypeOnlyBoundaryPressure(boundaries: ReturnType<typeof measureBoundaries>): Promise<void> {
    await recordHealthMetric({
        metricId: 'complexity-pressure-boundary-complexity-type-only',
        metricName: 'Type-Only Boundary Complexity',
        description: `Warning-only diagnostic for erased type-only cross-package imports. The CI aggregate boundary gate weights this pressure at ${TYPE_ONLY_BOUNDARY_COMPLEXITY_WEIGHT}.`,
        category: 'Complexity',
        current: boundaries.aggregateTypeOnlyBci,
        budget: 0,
        comparison: 'lte',
        severity: 'warning',
        unit: 'bci',
        details: {
            typeOnlyWeightInAggregateBoundaryComplexity: TYPE_ONLY_BOUNDARY_COMPLEXITY_WEIGHT,
            aggregateRawBci: boundaries.aggregateRawBci,
            aggregateRuntimeBci: boundaries.aggregateRuntimeBci,
            aggregateWeightedBci: boundaries.aggregateBci,
            topTypeOnlyPairs: [...boundaries.pairMetrics]
                .sort((a, b) => b.typeOnlyBci - a.typeOnlyBci || a.pair.localeCompare(b.pair))
                .slice(0, 10)
                .map(pair => ({
                    pair: pair.pair,
                    typeOnlyBci: pair.typeOnlyBci,
                    typeOnlyEdgeCount: pair.typeOnlyEdgeCount,
                })),
        },
    })
}

async function removeRetiredLegacyPressureReports(): Promise<void> {
    await removeHealthReports(PRESSURE_AXIS_CONFIGS.map(config => config.metricId))
}

describe('complexity pressure axes', () => {
    it('records the calibrated pressure rollup using whole-repo axis semantics', async () => {
        const {axes, boundaries} = await computePressureReport()
        const failingAxes = axes.filter(axis => !axis.passed).map(axis => axis.name)
        const {rscd, topFiveRatiosForRscd, topFiveExcessRatiosForRscd} = computeRscd(axes)
        const message = failureMessage(axes, rscd)

        await removeRetiredLegacyPressureReports()
        await recordHealthMetric({
            metricId: 'pressure-axes',
            metricName: 'Complexity Pressure Axes',
            description: 'Consolidated 10-axis complexity-pressure rollup',
            category: 'Complexity',
            current: rscd,
            budget: 1.0,
            comparison: 'lte',
            unit: 'rscd',
            details: {
                axes,
                failingAxes,
                topFiveRatiosForRscd,
                topFiveExcessRatiosForRscd,
                rscd,
                pressureHeadroomDebtRatio: PRESSURE_HEADROOM_DEBT_RATIO,
                boundaryComplexityWeighting: {
                    runtimeWeight: 1,
                    typeOnlyWeight: TYPE_ONLY_BOUNDARY_COMPLEXITY_WEIGHT,
                    aggregateRawBci: boundaries.aggregateRawBci,
                    aggregateRuntimeBci: boundaries.aggregateRuntimeBci,
                    aggregateTypeOnlyBci: boundaries.aggregateTypeOnlyBci,
                    aggregateWeightedBci: boundaries.aggregateBci,
                },
            },
        })
        await recordSidecarTargets(axes)
        await recordTypeOnlyBoundaryPressure(boundaries)

        for (const pressureAxis of axes) {
            if (pressureAxis.comparison === 'gte') {
                expect.soft(pressureAxis.current, message).toBeGreaterThanOrEqual(pressureAxis.budget)
            } else {
                expect.soft(pressureAxis.current, message).toBeLessThanOrEqual(pressureAxis.budget)
            }
        }
        expect(rscd, message).toBeLessThanOrEqual(1.0)
    }, 120000)
})
