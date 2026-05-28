import {existsSync, realpathSync} from 'node:fs'
import {readdir} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ts, type ExportDeclaration, type ImportDeclaration, type Project, type SourceFile} from 'ts-morph'
import {beforeAll, describe, expect, it} from 'vitest'
import {discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {createRepoTsMorphProject} from '../../_shared/graph/repo-ts-morph-project'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

const SERVER_PACKAGE_DIR = 'packages/systems/graph-db-server'
const CONSUMER_PACKAGE_DIRS: readonly string[] = [
    'webapp',
    'packages/systems/agent-runtime',
    'packages/systems/vt-daemon',
    'packages/systems/voicetree-cli',
] as const

// Mirrors ALLOWED_GRAPH_DB_SERVER_IMPORT_FILES in package-boundaries.test.ts.
// Keep these in sync with the BF-271e ratchet.
const DAEMON_OWNED_MUTATIONS_LAUNCHER_ALLOWLIST: ReadonlySet<string> = new Set([
    'packages/systems/voicetree-cli/src/commands/runtime/serve.ts',
    'packages/systems/voicetree-cli/src/commands/runtime/daemonRouteParity.ts',
    'packages/systems/voicetree-cli/src/commands/graph/actions/index-cmds.ts',
    'packages/systems/voicetree-cli/src/commands/graph/core/types.ts',
    // BF-371: bin/vtd.ts (formerly bin/vt-mcpd.ts) no longer embeds
    // graph-db-server — it talks to vt-graphd via @vt/graph-db-client as a
    // SIBLING process. No allowlist entry required.
])

const DAEMON_OWNED_MUTATIONS_NON_LAUNCHER_RUNTIME_EDGE_BUDGET = 0
const CROSS_PACKAGE_RELATIVE_IMPORT_BUDGET = 0

type ImportEdge = {
    readonly importerFile: string
    readonly importerPackage: string
    readonly importeeFile: string
    readonly importeePackage: string
    readonly line: number
    readonly specifier: string
    readonly kind: 'static' | 'dynamic' | 'export-from'
    readonly runtime: boolean
    readonly typeOnly: boolean
    readonly runtimeSymbols: readonly string[]
}

// Canonicalize through symlinks so package-manager layouts that resolve
// workspace deps via per-package symlinks (pnpm) report the same canonical
// path as direct hoisting (npm). Without this, `webapp/node_modules/@vt/X/...`
// paths leak into edge data and confuse the cross-package boundary check.
function canonical(absPath: string): string {
    try { return realpathSync(absPath) } catch { return absPath }
}

function repoRel(absPath: string): string {
    return relative(REPO_ROOT, canonical(absPath)).replaceAll('\\', '/')
}

function findPackageRoot(filePath: string): string {
    let dir = dirname(canonical(filePath))
    while (dir !== REPO_ROOT && dir !== dirname(dir)) {
        if (existsSync(join(dir, 'package.json'))) return repoRel(dir) || '.'
        dir = dirname(dir)
    }
    return '.'
}

function importerInScope(pkg: string): boolean {
    return CONSUMER_PACKAGE_DIRS.some(p => pkg === p || pkg.startsWith(`${p}/`))
}

function importeeIsServer(file: string): boolean {
    return file.startsWith(`${SERVER_PACKAGE_DIR}/`)
}

function importerIsServer(pkg: string): boolean {
    return pkg === SERVER_PACKAGE_DIR || pkg.startsWith(`${SERVER_PACKAGE_DIR}/`)
}

async function buildProject(packages: readonly PackageInfo[]): Promise<Project> {
    const project = createRepoTsMorphProject(REPO_ROOT, packages)
    project.addSourceFilesAtPaths(await discoverProductionSourcePaths())
    if (project.getSourceFiles().length === 0) {
        throw new Error('import-graph-invariants found 0 production source files; check globs against concurrent package moves')
    }
    return project
}

async function discoverProductionSourcePaths(): Promise<string[]> {
    const roots = [
        resolve(REPO_ROOT, 'packages', 'libraries'),
        resolve(REPO_ROOT, 'packages', 'systems'),
        resolve(REPO_ROOT, 'webapp', 'src'),
    ]
    const nested = await Promise.all(roots.map(root => walkSourcePaths(root)))
    return nested.flat().filter(isProductionSourcePath).sort()
}

async function walkSourcePaths(dir: string): Promise<string[]> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
        entries = await readdir(dir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const nested = await Promise.all(entries.map(async entry => {
        const path = resolve(dir, entry.name)
        if (entry.isDirectory()) {
            if (IGNORED_SOURCE_DIR_NAMES.has(entry.name)) return []
            return walkSourcePaths(path)
        }
        if (!entry.isFile() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) return []
        return [path]
    }))
    return nested.flat()
}

const IGNORED_SOURCE_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'build',
    '__tests__',
    '__generated__',
    'integration-tests',
    'tests',
])

function staticImportRuntimeSymbols(decl: ImportDeclaration): readonly string[] {
    if (decl.isTypeOnly()) return []
    const symbols: string[] = []
    const def = decl.getDefaultImport()
    if (def) symbols.push(def.getText())
    const ns = decl.getNamespaceImport()
    if (ns) symbols.push(`* as ${ns.getText()}`)
    const named = decl.getNamedImports()
    for (const n of named) {
        if (!n.isTypeOnly()) symbols.push(n.getName())
    }
    if (symbols.length === 0 && !def && !ns && named.length === 0) {
        symbols.push('<side-effect>')
    }
    return symbols
}

function exportRuntimeSymbols(decl: ExportDeclaration): readonly string[] {
    if (decl.isTypeOnly()) return []
    const named = decl.getNamedExports()
    if (named.length === 0) return ['*']
    return named.filter(n => !n.isTypeOnly()).map(n => n.getName())
}

function isProductionSourceFile(sourceFile: SourceFile): boolean {
    const file = repoRel(sourceFile.getFilePath())
    return isProductionSourcePath(file)
}

function isProductionSourcePath(file: string): boolean {
    return !file.endsWith('.test.ts')
        && !file.endsWith('.test.tsx')
        && !file.endsWith('.spec.ts')
        && !file.endsWith('.spec.tsx')
        && !file.endsWith('.d.ts')
        && !file.includes('/__tests__/')
        && !file.includes('/tests/')
        && !file.includes('/__generated__/')
        && !file.includes('/integration-tests/')
        && !file.includes('/dist/')
        && !file.includes('/build/')
        && !file.endsWith('.config.ts')
}

function buildEdge(args: {
    importerFile: string
    importerPackage: string
    target: SourceFile
    line: number
    specifier: string
    kind: ImportEdge['kind']
    typeOnly: boolean
    runtimeSymbols: readonly string[]
}): ImportEdge {
    const importeeAbs = args.target.getFilePath()
    const importeeFile = repoRel(importeeAbs)
    const importeePackage = findPackageRoot(importeeAbs)
    const runtime = !args.typeOnly && args.runtimeSymbols.length > 0
    return {
        importerFile: args.importerFile,
        importerPackage: args.importerPackage,
        importeeFile,
        importeePackage,
        line: args.line,
        specifier: args.specifier,
        kind: args.kind,
        runtime,
        typeOnly: args.typeOnly,
        runtimeSymbols: args.runtimeSymbols,
    }
}

function collectEdges(project: Project): readonly ImportEdge[] {
    const edges: ImportEdge[] = []
    for (const sourceFile of project.getSourceFiles()) {
        if (!isProductionSourceFile(sourceFile)) continue
        const importerAbs = sourceFile.getFilePath()
        const importerFile = repoRel(importerAbs)
        const importerPackage = findPackageRoot(importerAbs)

        for (const decl of sourceFile.getImportDeclarations()) {
            const target = decl.getModuleSpecifierSourceFile()
            if (!target) continue
            edges.push(buildEdge({
                importerFile,
                importerPackage,
                target,
                line: decl.getStartLineNumber(),
                specifier: decl.getModuleSpecifierValue(),
                kind: 'static',
                typeOnly: decl.isTypeOnly(),
                runtimeSymbols: staticImportRuntimeSymbols(decl),
            }))
        }

        for (const decl of sourceFile.getExportDeclarations()) {
            if (!decl.hasModuleSpecifier()) continue
            const target = decl.getModuleSpecifierSourceFile()
            if (!target) continue
            edges.push(buildEdge({
                importerFile,
                importerPackage,
                target,
                line: decl.getStartLineNumber(),
                specifier: decl.getModuleSpecifierValue() ?? '<unknown>',
                kind: 'export-from',
                typeOnly: decl.isTypeOnly(),
                runtimeSymbols: exportRuntimeSymbols(decl),
            }))
        }

        for (const call of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)) {
            if (call.getExpression().getKind() !== ts.SyntaxKind.ImportKeyword) continue
            const arg = call.getArguments()[0]
            if (!arg || arg.getKind() !== ts.SyntaxKind.StringLiteral) continue
            const literal = arg.asKindOrThrow(ts.SyntaxKind.StringLiteral)
            const specifier = literal.getLiteralValue()
            const targetPath = specifier.startsWith('.')
                ? resolve(dirname(sourceFile.getFilePath()), specifier)
                : specifier
            const target = sourceFile.getProject().getSourceFile(targetPath)
            if (!target) continue
            edges.push(buildEdge({
                importerFile,
                importerPackage,
                target,
                line: call.getStartLineNumber(),
                specifier,
                kind: 'dynamic',
                typeOnly: false,
                runtimeSymbols: ['<dynamic>'],
            }))
        }
    }
    return edges
}

function formatBoundaryViolation(e: ImportEdge): string {
    const symbols = e.runtimeSymbols.length > 0 ? ` runtime=[${e.runtimeSymbols.join(', ')}]` : ''
    return `${e.importerFile}:${e.line} → ${e.importeeFile} via ${e.kind} '${e.specifier}'${symbols}`
}

function formatRelativeViolation(e: ImportEdge): string {
    return `${e.importerFile}:${e.line} '${e.specifier}' → ${e.importeeFile} (${e.importerPackage} ↛ ${e.importeePackage})`
}

let edgesPromise: Promise<readonly ImportEdge[]> | undefined

async function getEdges(): Promise<readonly ImportEdge[]> {
    edgesPromise ??= discoverPackages(REPO_ROOT).then(async packages => collectEdges(await buildProject(packages)))
    return edgesPromise
}

describe('import graph: daemon-owned-mutations boundary', () => {
    let edges: readonly ImportEdge[]

    beforeAll(async () => {
        edges = await getEdges()
    }, 60000)

    it('blocks consumer runtime imports into graph-db-server outside the launcher allowlist', async () => {
        const violations = edges.filter(e =>
            importerInScope(e.importerPackage)
            && !importerIsServer(e.importerPackage)
            && importeeIsServer(e.importeeFile)
            && e.runtime
            && !DAEMON_OWNED_MUTATIONS_LAUNCHER_ALLOWLIST.has(e.importerFile),
        )

        const allowlistedRuntime = edges.filter(e =>
            importerInScope(e.importerPackage)
            && !importerIsServer(e.importerPackage)
            && importeeIsServer(e.importeeFile)
            && e.runtime
            && DAEMON_OWNED_MUTATIONS_LAUNCHER_ALLOWLIST.has(e.importerFile),
        )

        const typeOnlyIntoServer = edges.filter(e =>
            importerInScope(e.importerPackage)
            && !importerIsServer(e.importerPackage)
            && importeeIsServer(e.importeeFile)
            && !e.runtime,
        )

        console.info(
            `Daemon-owned-mutations graph-boundary invariant: violations=${violations.length} allowlistedRuntime=${allowlistedRuntime.length} typeOnly=${typeOnlyIntoServer.length}`,
        )

        await recordHealthMetric({
            metricId: 'daemon-owned-mutations-graph-boundary-runtime-edges',
            metricName: 'Daemon-Owned Mutations Graph-Boundary Runtime Edges',
            description: 'ts-morph resolved import edges from {webapp, agent-runtime, vt-daemon} into graph-db-server with at least one runtime binding, outside the launcher/search allowlist. Catches package-spec, deep-relative, and barrel-re-exported back-channels uniformly.',
            category: 'Coupling',
            current: violations.length,
            budget: DAEMON_OWNED_MUTATIONS_NON_LAUNCHER_RUNTIME_EDGE_BUDGET,
            comparison: 'lte',
            unit: 'edges',
            details: {
                violations,
                allowlistedRuntimeEdges: allowlistedRuntime,
                typeOnlyIntoServerEdges: typeOnlyIntoServer,
            },
        })

        expect(
            violations.map(formatBoundaryViolation),
            violations.length === 0
                ? 'No graph-boundary runtime violations.'
                : `Forbidden graph-db-server runtime edges from non-launcher consumers:\n  ${violations.map(formatBoundaryViolation).join('\n  ')}`,
        ).toEqual([])
    })
})

describe('import graph: cross-package relative imports', () => {
    let edges: readonly ImportEdge[]

    beforeAll(async () => {
        edges = await getEdges()
    }, 60000)

    it('keeps cross-package relative imports at zero', async () => {
        const violations = edges.filter(e =>
            e.specifier.startsWith('.')
            && e.importerPackage !== e.importeePackage,
        )

        console.info(`Cross-package relative imports: ${violations.length}`)

        await recordHealthMetric({
            metricId: 'cross-package-relative-imports',
            metricName: 'Cross-Package Relative Imports',
            description: 'Production imports whose relative specifier (./ or ../) resolves outside the importer\'s own package root. Bypassing a package\'s public surface via deep-relative paths is forbidden regardless of target package.',
            category: 'Coupling',
            current: violations.length,
            budget: CROSS_PACKAGE_RELATIVE_IMPORT_BUDGET,
            comparison: 'lte',
            unit: 'imports',
            details: {violations},
        })

        expect(
            violations.map(formatRelativeViolation),
            violations.length === 0
                ? 'No cross-package relative imports.'
                : `Cross-package relative imports detected:\n  ${violations.map(formatRelativeViolation).join('\n  ')}`,
        ).toEqual([])
    })
})
