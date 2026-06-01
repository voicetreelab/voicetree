import {readFileSync} from 'node:fs'
import {readdir, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')

const {bannedRelativePathBudget: BANNED_RELATIVE_PATH_BUDGET} = readBudgetSync<{bannedRelativePathBudget: number}>('shape/relative-path-depth.json')

const REQUESTED_SCOPE_ROOTS = [
    'webapp/src',
    'packages/systems/*/src',
    'packages/libraries/*/src',
    'packages/systems/vt-daemon/bin',
] as const

const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '__tests__', 'integration-tests'])

type LiteralKind = 'string-literal' | 'template-no-substitution' | 'template-head'
type RelativePathDepth = '../../x' | '../../../+x'

type LiteralSite = {
    readonly kind: LiteralKind
    readonly value: string
    readonly line: number
    readonly column: number
}

type RelativePathRecord = {
    readonly file: string
    readonly line: number
    readonly column: number
    readonly kind: LiteralKind
    readonly value: string
    readonly depth: RelativePathDepth
    readonly statement: string
}

async function discoverSourceRoots(): Promise<string[]> {
    const packageSrcRoots = await Promise.all([
        discoverPackageSrcRoots(join(REPO_ROOT, 'packages', 'systems')),
        discoverPackageSrcRoots(join(REPO_ROOT, 'packages', 'libraries')),
    ])

    return [
        join(REPO_ROOT, 'webapp', 'src'),
        ...packageSrcRoots.flat(),
        join(REPO_ROOT, 'packages', 'systems', 'vt-daemon', 'bin'),
    ]
}

async function discoverPackageSrcRoots(layerRoot: string): Promise<string[]> {
    if (!(await pathExists(layerRoot))) return []
    const entries = await readdir(layerRoot, {withFileTypes: true})
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => join(layerRoot, entry.name, 'src'))
}

async function listProductionSourceFiles(roots: readonly string[]): Promise<string[]> {
    const nested = await Promise.all(roots.map(async root => {
        if (!(await pathExists(root))) return []
        return listProductionSourcesUnder(root)
    }))

    return [...new Set(nested.flat())].sort((a, b) => relative(REPO_ROOT, a).localeCompare(relative(REPO_ROOT, b)))
}

async function listProductionSourcesUnder(root: string): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const absolutePath = join(root, entry.name)
        if (entry.isDirectory()) {
            if (EXCLUDED_DIR_NAMES.has(entry.name)) return []
            return listProductionSourcesUnder(absolutePath)
        }
        if (!entry.isFile() || !isProductionTypeScriptSource(absolutePath)) return []
        return [absolutePath]
    }))
    return nested.flat()
}

function isProductionTypeScriptSource(path: string): boolean {
    return /\.(ts|tsx)$/.test(path)
        && !/\.d\.ts$/.test(path)
        && !/\.(test|spec)\.(ts|tsx)$/.test(path)
        && !/\.config\.ts$/.test(path)
        && !containsExcludedSegment(path)
}

function containsExcludedSegment(path: string): boolean {
    const segments = relative(REPO_ROOT, path).split(sep)
    return segments.some(segment => EXCLUDED_DIR_NAMES.has(segment))
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

function collectRelativePathRecords(sourceFiles: readonly string[]): RelativePathRecord[] {
    return sourceFiles.flatMap(file => {
        const text = readFileSync(file, 'utf8')
        const sourceFile = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )

        return extractPathStringLiterals(sourceFile)
            .filter(site => isDeepRelativePath(site.value))
            .map(site => ({
                file: normalizePath(relative(REPO_ROOT, file)),
                line: site.line,
                column: site.column,
                kind: site.kind,
                value: site.value,
                depth: relativeDepthBucket(site.value),
                statement: statementTextAt(sourceFile, site.line),
            }))
    })
}

function extractPathStringLiterals(sourceFile: ts.SourceFile): LiteralSite[] {
    const sites: LiteralSite[] = []
    const importSpecifierNodes = new Set<ts.StringLiteralLike>(collectImportSpecifierNodes(sourceFile))

    function visit(node: ts.Node): void {
        if (importSpecifierNodes.has(node as ts.StringLiteralLike)) {
            // Import specifiers are covered by relative-import-depth.
        } else if (ts.isStringLiteral(node)) {
            sites.push(literalSite('string-literal', node.text, node, sourceFile))
        } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
            sites.push(literalSite('template-no-substitution', node.text, node, sourceFile))
        } else if (ts.isTemplateExpression(node)) {
            sites.push(literalSite('template-head', node.head.text, node.head, sourceFile))
        }

        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return sites
}

function collectImportSpecifierNodes(sourceFile: ts.SourceFile): ts.StringLiteralLike[] {
    const nodes: ts.StringLiteralLike[] = []

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
            nodes.push(node.moduleSpecifier)
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
            nodes.push(node.moduleSpecifier)
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [firstArg] = node.arguments
            if (firstArg && ts.isStringLiteralLike(firstArg)) nodes.push(firstArg)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
            nodes.push(node.argument.literal)
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression
            if (ts.isStringLiteralLike(expression)) nodes.push(expression)
        }

        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return nodes
}

function literalSite(kind: LiteralKind, value: string, node: ts.Node, sourceFile: ts.SourceFile): LiteralSite {
    const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return {
        kind,
        value,
        line: line + 1,
        column: character + 1,
    }
}

function isDeepRelativePath(value: string): boolean {
    return /^\.\.\/\.\.\//.test(value)
}

function relativeDepthBucket(value: string): RelativePathDepth {
    const matches = value.match(/^(\.\.\/)+/)
    const depth = matches ? matches[0].split('../').length - 1 : 0
    if (depth === 2) return '../../x'
    return '../../../+x'
}

function statementTextAt(sourceFile: ts.SourceFile, oneBasedLine: number): string {
    const lineStarts = sourceFile.getLineStarts()
    const start = lineStarts[oneBasedLine - 1] ?? 0
    const end = lineStarts[oneBasedLine] ?? sourceFile.getFullText().length
    return sourceFile.getFullText().slice(start, end).trim()
}

function summarizeRelativePaths(
    allRecords: readonly RelativePathRecord[],
    sourceFileCount: number,
    sourceRoots: readonly string[],
) {
    return {
        generatedAt: new Date().toISOString(),
        sourceFileCount,
        scope: {
            requestedRoots: REQUESTED_SCOPE_ROOTS,
            scannedRoots: sourceRoots.map(root => normalizePath(relative(REPO_ROOT, root))),
            excluded: [
                '.test.ts',
                '.spec.ts',
                '.d.ts',
                '__tests__',
                'integration-tests',
                'node_modules',
                'dist',
                'build',
                '*.config.ts',
            ],
            note: 'Scans non-import string + template-literal heads for paths matching /^\\.\\.\\/\\.\\.\\//. Import specifiers are covered by relative-import-depth.',
        },
        totals: {
            relativePaths: allRecords.length,
            bannedRelativePaths: allRecords.length,
        },
        byDepth: countBy(allRecords, record => record.depth, ['../../x', '../../../+x']),
        byKind: countBy(allRecords, record => record.kind, ['string-literal', 'template-no-substitution', 'template-head']),
        perFile: summarizePerFile(allRecords),
        bannedRelativePaths: allRecords.map(record => ({
            file: record.file,
            line: record.line,
            column: record.column,
            kind: record.kind,
            depth: record.depth,
            value: record.value,
            statement: record.statement,
        })),
    }
}

function summarizePerFile(records: readonly RelativePathRecord[]) {
    const byFile = new Map<string, {file: string, count: number}>()
    for (const record of records) {
        const data = byFile.get(record.file) ?? {file: record.file, count: 0}
        data.count += 1
        byFile.set(record.file, data)
    }
    return [...byFile.values()].sort((a, b) =>
        b.count - a.count || a.file.localeCompare(b.file))
}

function countBy<T, K extends string>(records: readonly T[], keyFn: (record: T) => K, orderedKeys: readonly K[]): Record<K, number> {
    const counts = Object.fromEntries(orderedKeys.map(key => [key, 0])) as Record<K, number>
    for (const record of records) {
        counts[keyFn(record)] = (counts[keyFn(record)] ?? 0) + 1
    }
    return counts
}

function normalizePath(path: string): string {
    return path.split(sep).join('/')
}

describe('relative path depth', () => {
    it('keeps deep relative non-import path strings at zero', async () => {
        const sourceRoots = await discoverSourceRoots()
        const files = await listProductionSourceFiles(sourceRoots)
        if (files.length === 0) {
            throw new Error('relative-path-depth found 0 production source files; check source globs')
        }

        const summary = summarizeRelativePaths(
            collectRelativePathRecords(files),
            files.length,
            sourceRoots,
        )

        console.info(
            `Relative path depth: ${summary.totals.bannedRelativePaths} banned relative path string(s) across ${summary.sourceFileCount} source files`,
        )

        await recordHealthMetric({
            metricId: 'relative-path-depth',
            metricName: 'Relative Path Depth',
            description: 'Non-import string and template path literals using ../../+ depth.',
            category: 'Shape',
            current: summary.totals.bannedRelativePaths,
            budget: BANNED_RELATIVE_PATH_BUDGET,
            comparison: 'lte',
            unit: 'paths',
            details: summary,
        })

        expect(
            summary.bannedRelativePaths.map(record => `${record.file}:${record.line}:${record.column} ${JSON.stringify(record.value)}`),
            summary.bannedRelativePaths.length === 0
                ? 'No banned relative path strings.'
                : `Banned relative path strings:\n${summary.bannedRelativePaths.map(record => `  ${record.file}:${record.line}:${record.column} ${JSON.stringify(record.value)}`).join('\n')}`,
        ).toEqual([])
    })
})
