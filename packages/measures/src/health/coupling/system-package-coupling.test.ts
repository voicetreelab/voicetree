import {readdir, readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT} from '../../_shared/discovery/discover-packages'

const REPO_ROOT: string = DEFAULT_REPO_ROOT

const SYSTEM_PACKAGES: ReadonlySet<string> = new Set([
    // The daemon package owns graph mutation execution; runtime fan-in should stay small and explicit.
    '@vt/graph-db-server',
    // The vt-daemon package is the external control-plane adapter; new runtime consumers need review.
    '@vt/vt-daemon',
    // The graph-db client is the stable daemon client/launcher surface; broad fan-in stays bounded.
    '@vt/graph-db-client',
])

const RUNTIME_SYMBOL_THRESHOLD = 15
const DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD = 0

const SCAN_ROOTS: readonly string[] = [
    'packages/libraries',
    'packages/systems',
    'webapp/src',
] as const

const PACKAGE_DIR_LAYERS: readonly string[] = [
    'libraries',
    'systems',
] as const

const ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES: ReadonlySet<string> = new Set([
    // Projectless graph-db-client launcher embeds a daemon start import in the child-process eval script.
    'packages/systems/graph-db-client/src/autoLaunch/projectlessSpawn.ts',
    // CLI serve command is the intentional entrypoint for starting the daemon.
    'packages/systems/voicetree-cli/src/commands/runtime/serve.ts',
    // Route-parity command imports daemon route types for CLI/API consistency checks.
    'packages/systems/voicetree-cli/src/commands/runtime/daemonRouteParity.ts',
    // Graph CLI index command intentionally reaches the daemon search backend.
    'packages/systems/voicetree-cli/src/commands/graph/actions/index-cmds.ts',
    // Graph CLI shared types expose search-result shape without runtime daemon ownership.
    'packages/systems/voicetree-cli/src/commands/graph/core/types.ts',
    // BF-371: bin/vtd.ts (formerly bin/vt-mcpd.ts) no longer imports
    // graph-db-server — it talks to vt-graphd via @vt/graph-db-client as a
    // SIBLING process. No allowlist entry required.
])

type RuntimeSites = {
    readonly prod: Map<string, Set<string>>
    readonly test: Map<string, Set<string>>
}

type PackageCouplingData = {
    readonly runtime: RuntimeSites
    readonly types: Set<string>
    readonly reExportFiles: Set<string>
}

type SymbolFileEntry = {
    readonly symbol: string
    readonly file: string
}

type SystemPackageSummary = {
    readonly packageName: string
    readonly runtimeProdSymbols: number
    readonly runtimeTestSymbols: number
    readonly typeOnlySymbols: number
    readonly productionFiles: number
    readonly topRuntimeSymbols: readonly string[]
    readonly reExportFiles: readonly string[]
}

let packageDataPromise: Promise<ReadonlyMap<string, PackageCouplingData>> | undefined

function emptyPackageData(): PackageCouplingData {
    return {
        runtime: {prod: new Map(), test: new Map()},
        types: new Set(),
        reExportFiles: new Set(),
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function listFiles(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listFiles(path)
        if (entry.isFile() && /\.(ts|tsx)$/.test(path)) return [path]
        return []
    }))
    return nested.flat().sort()
}

async function buildPackageDirMap(): Promise<ReadonlyMap<string, string>> {
    const entries: [string, string][] = []
    for (const layer of PACKAGE_DIR_LAYERS) {
        const layerDir = join(REPO_ROOT, 'packages', layer)
        if (!(await pathExists(layerDir))) continue
        for (const dirent of await readdir(layerDir, {withFileTypes: true})) {
            if (dirent.isDirectory()) {
                entries.push([`@vt/${dirent.name}`, `packages/${layer}/${dirent.name}/`])
            }
        }
    }
    return new Map(entries)
}

function repoRelativePath(path: string): string {
    return path.startsWith(REPO_ROOT + '/')
        ? path.slice(REPO_ROOT.length + 1)
        : path
}

function isTestFile(filePath: string): boolean {
    return /\.(test|spec)\.(ts|tsx)$/.test(filePath)
        || filePath.includes('__tests__/')
        || filePath.includes('integration-tests/')
        || /\.helpers?\.(ts|tsx)$/.test(filePath)
}

function ensurePackageData(
    packageData: Map<string, PackageCouplingData>,
    packageName: string,
): PackageCouplingData {
    const existing = packageData.get(packageName)
    if (existing) return existing
    const created = emptyPackageData()
    packageData.set(packageName, created)
    return created
}

function scanImportLine(
    packageData: Map<string, PackageCouplingData>,
    packageDirs: ReadonlyMap<string, string>,
    filePath: string,
    code: string,
): void {
    const packageMatch = code.match(/from\s+['"](@vt\/[^/'"]+)(\/.+)?['"]/)
    if (!packageMatch) return

    const packageName = packageMatch[1]
    if (!SYSTEM_PACKAGES.has(packageName)) return

    const packageDir = packageDirs.get(packageName)
    if (packageDir && filePath.startsWith(packageDir)) return

    const symbolMatch = code.match(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/)
    if (!symbolMatch) return

    const data = ensurePackageData(packageData, packageName)
    const testFile = isTestFile(filePath)
    const siteMap = testFile ? data.runtime.test : data.runtime.prod
    const isWholeTypeImport = /(?:import|export)\s+type\s*\{/.test(code)
    const isReExport = /export\s*(?:type\s*)?\{/.test(code)
    if (isReExport && !testFile) data.reExportFiles.add(filePath)

    const rawSymbols = symbolMatch[1]
        .split(',')
        .map(symbol => symbol.trim())
        .filter(Boolean)

    for (const rawSymbol of rawSymbols) {
        const isType = isWholeTypeImport || rawSymbol.startsWith('type ')
        const name = rawSymbol.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
        if (!name) continue

        if (isType) {
            data.types.add(name)
        } else {
            const existing = siteMap.get(name)
            if (existing) existing.add(filePath)
            else siteMap.set(name, new Set([filePath]))
        }
    }
}

async function scanSystemPackageCoupling(): Promise<ReadonlyMap<string, PackageCouplingData>> {
    const packageDirs = await buildPackageDirMap()
    const packageData = new Map<string, PackageCouplingData>()
    const files = (await Promise.all(
        SCAN_ROOTS.map(root => listFiles(join(REPO_ROOT, root))),
    )).flat()

    for (const absolutePath of files) {
        const filePath = repoRelativePath(absolutePath)
        const text = await readFile(absolutePath, 'utf8')
        for (const code of text.split(/\r?\n/)) {
            if (!code.includes("from '@vt/") && !code.includes('from "@vt/')) continue
            scanImportLine(packageData, packageDirs, filePath, code)
        }
    }

    return packageData
}

function getPackageData(): Promise<ReadonlyMap<string, PackageCouplingData>> {
    packageDataPromise ??= scanSystemPackageCoupling()
    return packageDataPromise
}

function symbolFileEntries(symbolFiles: ReadonlyMap<string, ReadonlySet<string>>): readonly SymbolFileEntry[] {
    return [...symbolFiles.entries()].flatMap(([symbol, files]) =>
        [...files].map(file => ({symbol, file})),
    )
}

function summarizeSymbolCounts(entries: readonly SymbolFileEntry[]): readonly string[] {
    const counts = new Map<string, Set<string>>()
    for (const {symbol, file} of entries) {
        const existing = counts.get(symbol)
        if (existing) existing.add(file)
        else counts.set(symbol, new Set([file]))
    }
    return [...counts.entries()]
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .map(([symbol, files]) => `${symbol}(${files.size})`)
}

function summarizePackage(packageName: string, data: PackageCouplingData): SystemPackageSummary {
    const runtimeEntries = symbolFileEntries(data.runtime.prod)
    return {
        packageName,
        runtimeProdSymbols: data.runtime.prod.size,
        runtimeTestSymbols: data.runtime.test.size,
        typeOnlySymbols: data.types.size,
        productionFiles: new Set(runtimeEntries.map(entry => entry.file)).size,
        topRuntimeSymbols: summarizeSymbolCounts(runtimeEntries).slice(0, 8),
        reExportFiles: [...data.reExportFiles].sort(),
    }
}

function formatSystemPackageSummary(summary: SystemPackageSummary): string {
    const lines = [
        `${summary.packageName}: ${summary.runtimeProdSymbols} runtime prod, ${summary.runtimeTestSymbols} runtime test, ${summary.typeOnlySymbols} type-only`,
    ]
    if (summary.topRuntimeSymbols.length > 0) {
        lines.push(`  top: ${summary.topRuntimeSymbols.join(', ')}`)
    }
    if (summary.reExportFiles.length > 0) {
        lines.push(`  re-exported through: ${summary.reExportFiles.join(', ')}`)
    }
    return lines.join('\n')
}

describe('system package coupling bounds', () => {
    it('keeps runtime symbol fan-in to system packages under the ratchet threshold', async () => {
        const packageData = await getPackageData()
        const summaries = [...SYSTEM_PACKAGES]
            .sort()
            .map(packageName => summarizePackage(packageName, packageData.get(packageName) ?? emptyPackageData()))

        console.info([
            'System package coupling report',
            `Threshold: ${RUNTIME_SYMBOL_THRESHOLD} production runtime symbols.`,
            ...summaries.map(formatSystemPackageSummary),
        ].join('\n\n'))

        const violations = summaries
            .filter(summary => summary.runtimeProdSymbols > RUNTIME_SYMBOL_THRESHOLD)
            .map(summary => `${summary.packageName}: ${summary.runtimeProdSymbols} runtime production symbols across ${summary.productionFiles} production files`)

        expect(violations, violations.join('\n')).toEqual([])
    })

    it('keeps graph-db-server runtime imports inside launcher/search/parity entrypoints', async () => {
        const packageData = await getPackageData()
        const data = packageData.get('@vt/graph-db-server') ?? emptyPackageData()
        const runtimeEntries = symbolFileEntries(data.runtime.prod)
        const nonLauncherRuntimeEntries = runtimeEntries
            .filter(({file}) => !ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES.has(file))
            .sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol))
        const allowlistedRuntimeEntries = runtimeEntries
            .filter(({file}) => ALLOWED_GRAPH_DB_SERVER_RUNTIME_IMPORT_FILES.has(file))

        console.info([
            'Daemon-owned-mutations coupling ratchet:',
            `nonLauncherGraphDbServerRuntimeImports=${nonLauncherRuntimeEntries.length} / ${DAEMON_OWNED_NON_LAUNCHER_RUNTIME_IMPORT_THRESHOLD}`,
            `allowlistedGraphDbServerRuntimeImports=${allowlistedRuntimeEntries.length}`,
            `allowlisted top: ${summarizeSymbolCounts(allowlistedRuntimeEntries).join(', ')}`,
        ].join('\n'))

        expect(
            nonLauncherRuntimeEntries.map(({symbol, file}) => `${file}: ${symbol}`),
            'Forbidden @vt/graph-db-server runtime imports outside launcher/search/parity entrypoints.',
        ).toEqual([])
    })

})
