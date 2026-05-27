import {existsSync, readFileSync, statSync} from 'node:fs'
import {readdir, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(TEST_DIR, '../../../../..')

const BANNED_RELATIVE_IMPORT_BUDGET = 0

const REQUESTED_SCOPE_ROOTS = [
    'webapp/src',
    'packages/systems/*/src',
    'packages/libraries/*/src',
    'packages/systems/vt-daemon/bin',
] as const

const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '__tests__', 'integration-tests'])
const RESOLUTION_EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.json'] as const

type ImportKind = 'static' | 're-export' | 'dynamic' | 'import-type' | 'import-equals'
type ImportClassification = 'relative-cross-package' | 'relative-same-package'
type ImportDepth = './x' | '../x' | '../../x' | '../../../+x'

type ImportSite = {
    readonly kind: ImportKind
    readonly specifier: string
    readonly line: number
    readonly column: number
}

type RelativeImportRecord = {
    readonly importer: string
    readonly line: number
    readonly column: number
    readonly kind: ImportKind
    readonly specifier: string
    readonly depth: ImportDepth
    readonly classification: ImportClassification
    readonly importerPackage: string
    readonly importerPackageRoot: string
    readonly resolvedPath: string
    readonly targetPackage: string
    readonly targetPackageRoot: string
    readonly statement: string
}

const packageRootCache = new Map<string, string>()
const packageNameCache = new Map<string, string>()

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

function collectRelativeImportRecords(sourceFiles: readonly string[]): RelativeImportRecord[] {
    return sourceFiles.flatMap(file => {
        const text = readFileSync(file, 'utf8')
        const sourceFile = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )
        const packageRoot = findPackageRoot(file)
        const packageName = packageNameForRoot(packageRoot)

        return extractModuleSpecifiers(sourceFile)
            .filter(importSite => importSite.specifier.startsWith('.'))
            .map(importSite => classifyRelativeImport(file, packageRoot, packageName, importSite, sourceFile))
    })
}

function extractModuleSpecifiers(sourceFile: ts.SourceFile): ImportSite[] {
    const importSites: ImportSite[] = []

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
            importSites.push(importSite('static', node.moduleSpecifier, sourceFile))
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
            importSites.push(importSite('re-export', node.moduleSpecifier, sourceFile))
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [firstArg] = node.arguments
            if (firstArg && ts.isStringLiteralLike(firstArg)) importSites.push(importSite('dynamic', firstArg, sourceFile))
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
            importSites.push(importSite('import-type', node.argument.literal, sourceFile))
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression
            if (ts.isStringLiteralLike(expression)) importSites.push(importSite('import-equals', expression, sourceFile))
        }

        ts.forEachChild(node, visit)
    }

    visit(sourceFile)
    return importSites
}

function importSite(kind: ImportKind, literal: ts.StringLiteralLike, sourceFile: ts.SourceFile): ImportSite {
    const {line, character} = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
    return {
        kind,
        specifier: literal.text,
        line: line + 1,
        column: character + 1,
    }
}

function classifyRelativeImport(
    importerPath: string,
    importerPackageRoot: string,
    importerPackageName: string,
    site: ImportSite,
    sourceFile: ts.SourceFile,
): RelativeImportRecord {
    const resolvedPath = resolveRelativeSpecifier(importerPath, site.specifier)
    const targetPackageRoot = findPackageRoot(resolvedPath)
    const targetPackageName = packageNameForRoot(targetPackageRoot)
    const isCrossPackage = targetPackageRoot !== importerPackageRoot

    return {
        importer: normalizePath(relative(REPO_ROOT, importerPath)),
        line: site.line,
        column: site.column,
        kind: site.kind,
        specifier: site.specifier,
        depth: relativeDepthBucket(site.specifier),
        classification: isCrossPackage ? 'relative-cross-package' : 'relative-same-package',
        importerPackage: importerPackageName,
        importerPackageRoot: normalizePath(relative(REPO_ROOT, importerPackageRoot)),
        resolvedPath: normalizePath(relative(REPO_ROOT, resolvedPath)),
        targetPackage: targetPackageName,
        targetPackageRoot: normalizePath(relative(REPO_ROOT, targetPackageRoot)),
        statement: statementTextAt(sourceFile, site.line),
    }
}

function resolveRelativeSpecifier(importerPath: string, specifier: string): string {
    const basePath = resolve(dirname(importerPath), specifier)
    const candidates = [
        ...RESOLUTION_EXTENSIONS.map(extension => `${basePath}${extension}`),
        ...RESOLUTION_EXTENSIONS.filter(Boolean).map(extension => join(basePath, `index${extension}`)),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? basePath
}

function findPackageRoot(path: string): string {
    const startingDirectory = directoryForPackageLookup(path)
    const cached = packageRootCache.get(startingDirectory)
    if (cached) return cached

    let current = startingDirectory
    while (true) {
        if (existsSync(join(current, 'package.json'))) {
            packageRootCache.set(startingDirectory, current)
            return current
        }
        const parent = dirname(current)
        if (parent === current) {
            packageRootCache.set(startingDirectory, REPO_ROOT)
            return REPO_ROOT
        }
        current = parent
    }
}

function directoryForPackageLookup(path: string): string {
    if (existsSync(path)) {
        try {
            return statSync(path).isDirectory() ? path : dirname(path)
        } catch {
            return dirname(path)
        }
    }
    return /\.[a-z0-9]+$/i.test(path) ? dirname(path) : path
}

function packageNameForRoot(packageRoot: string): string {
    const cached = packageNameCache.get(packageRoot)
    if (cached) return cached

    const packageJsonPath = join(packageRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {name?: string}
    const name = packageJson.name ?? (normalizePath(relative(REPO_ROOT, packageRoot)) || 'repo-root')
    packageNameCache.set(packageRoot, name)
    return name
}

function relativeDepthBucket(specifier: string): ImportDepth {
    if (specifier.startsWith('./')) return './x'
    const matches = specifier.match(/^(\.\.\/)+/)
    const depth = matches ? matches[0].split('../').length - 1 : 0
    if (depth <= 1) return '../x'
    if (depth === 2) return '../../x'
    return '../../../+x'
}

function statementTextAt(sourceFile: ts.SourceFile, oneBasedLine: number): string {
    const lineStarts = sourceFile.getLineStarts()
    const start = lineStarts[oneBasedLine - 1] ?? 0
    const end = lineStarts[oneBasedLine] ?? sourceFile.getFullText().length
    return sourceFile.getFullText().slice(start, end).trim()
}

function summarizeRelativeImports(
    allRecords: readonly RelativeImportRecord[],
    sourceFileCount: number,
    sourceRoots: readonly string[],
) {
    const samePackageRecords = allRecords.filter(record => record.classification === 'relative-same-package')
    const crossPackageRecords = allRecords.filter(record => record.classification === 'relative-cross-package')
    const deepSamePackageRecords = samePackageRecords.filter(record => record.depth === '../../x' || record.depth === '../../../+x')
    const bannedRecords = [...crossPackageRecords, ...deepSamePackageRecords]

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
        },
        totals: {
            relativeImports: allRecords.length,
            samePackageRelativeImports: samePackageRecords.length,
            crossPackageRelativeImports: crossPackageRecords.length,
            deepSamePackageRelativeImports: deepSamePackageRecords.length,
            bannedRelativeImports: bannedRecords.length,
        },
        samePackageByDepth: countBy(samePackageRecords, record => record.depth, ['./x', '../x', '../../x', '../../../+x']),
        perPackageTotals: summarizePerPackage(allRecords),
        worstOffenders: summarizeWorstOffenders(allRecords),
        bannedRelatives: bannedRecords.map(record => ({
            importer: record.importer,
            line: record.line,
            specifier: record.specifier,
            kind: record.kind,
            classification: record.classification,
            depth: record.depth,
            importerPackage: record.importerPackage,
            targetPackage: record.targetPackage,
            resolvedPath: record.resolvedPath,
            statement: record.statement,
        })),
        crossPackageRelatives: crossPackageRecords.map(record => ({
            importer: record.importer,
            line: record.line,
            specifier: record.specifier,
            kind: record.kind,
            importerPackage: record.importerPackage,
            targetPackage: record.targetPackage,
            resolvedPath: record.resolvedPath,
            statement: record.statement,
        })),
    }
}

function summarizePerPackage(records: readonly RelativeImportRecord[]) {
    const packages = new Map<string, {
        package: string
        packageRoot: string
        relativeImports: number
        samePackageRelativeImports: number
        crossPackageRelativeImports: number
        samePackageByDepth: Record<ImportDepth, number>
    }>()

    for (const record of records) {
        const data = packages.get(record.importerPackage) ?? {
            package: record.importerPackage,
            packageRoot: record.importerPackageRoot,
            relativeImports: 0,
            samePackageRelativeImports: 0,
            crossPackageRelativeImports: 0,
            samePackageByDepth: {'./x': 0, '../x': 0, '../../x': 0, '../../../+x': 0},
        }

        data.relativeImports += 1
        if (record.classification === 'relative-cross-package') {
            data.crossPackageRelativeImports += 1
        } else {
            data.samePackageRelativeImports += 1
            data.samePackageByDepth[record.depth] += 1
        }
        packages.set(record.importerPackage, data)
    }

    return [...packages.values()].sort((a, b) =>
        b.relativeImports - a.relativeImports || a.package.localeCompare(b.package))
}

function summarizeWorstOffenders(records: readonly RelativeImportRecord[]) {
    const byFile = new Map<string, {
        file: string
        package: string
        relativeImports: number
        crossPackageRelativeImports: number
    }>()

    for (const record of records) {
        const data = byFile.get(record.importer) ?? {
            file: record.importer,
            package: record.importerPackage,
            relativeImports: 0,
            crossPackageRelativeImports: 0,
        }
        data.relativeImports += 1
        if (record.classification === 'relative-cross-package') data.crossPackageRelativeImports += 1
        byFile.set(record.importer, data)
    }

    return [...byFile.values()]
        .sort((a, b) =>
            b.crossPackageRelativeImports - a.crossPackageRelativeImports
            || b.relativeImports - a.relativeImports
            || a.file.localeCompare(b.file))
        .slice(0, 20)
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

describe('relative import depth', () => {
    it('keeps cross-package and deep same-package relative imports at zero', async () => {
        const sourceRoots = await discoverSourceRoots()
        const files = await listProductionSourceFiles(sourceRoots)
        if (files.length === 0) {
            throw new Error('relative-import-depth found 0 production source files; check source globs')
        }

        const summary = summarizeRelativeImports(
            collectRelativeImportRecords(files),
            files.length,
            sourceRoots,
        )

        console.info(
            `Relative import depth: ${summary.totals.bannedRelativeImports} banned relative import(s) across ${summary.sourceFileCount} source files`,
        )

        await recordHealthMetric({
            metricId: 'relative-import-depth',
            metricName: 'Relative Import Depth',
            description: 'Relative imports that cross package boundaries or use same-package ../../+ depth.',
            category: 'Coupling',
            current: summary.totals.bannedRelativeImports,
            budget: BANNED_RELATIVE_IMPORT_BUDGET,
            comparison: 'lte',
            unit: 'imports',
            details: summary,
        })

        expect(
            summary.bannedRelatives.map(record => `${record.importer}:${record.line} ${record.specifier} -> ${record.resolvedPath}`),
            summary.bannedRelatives.length === 0
                ? 'No banned relative imports.'
                : `Banned relative imports:\n${summary.bannedRelatives.map(record => `  ${record.importer}:${record.line} ${record.specifier} -> ${record.resolvedPath}`).join('\n')}`,
        ).toEqual([])
    })
})
