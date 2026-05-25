/**
 * Banned relative imports per touched community.
 *
 * Mirrors the full-graph invariant (health/coupling/relative-import-depth.test.ts):
 * an import is "banned" when it is RELATIVE and either
 *   - crosses a package boundary (any depth), or
 *   - stays in-package but uses `../../` or deeper.
 *
 * Why a subgraph version when full-graph already enforces the same rule:
 * the full-graph test only runs in the pre-push / CI path. A bad relative
 * import added during decomposition (e.g. `../../core/argv` after a folder
 * split) escapes commit and surfaces hours later. The subgraph gate runs
 * in pre-commit and fires immediately on the community the change touched.
 *
 * Scope: matches the full-graph scope roots (webapp/src,
 * packages/systems/<X>/src, packages/libraries/<X>/src, voicetree-mcp/bin).
 * Files outside that scope (e.g. the measures package itself) are not
 * scanned — the invariant they enforce is one for application code,
 * not the tooling that enforces it.
 *
 * Scoring:
 *   perCommunity[c] = number of banned relative imports across in-scope
 *   files in c.
 *
 * Thresholds (mirrors cycles.ts model):
 *   - Absolute fail: any banned import in a touched community.
 *   - Baseline-relative: any current > baseline is also a fail (for
 *     communities that already carry legacy debt before the gate was
 *     wired; should be empty under the full-graph invariant).
 *
 * needsInbound = false: only the importer's outgoing edges are relevant.
 * needsTsMorph = false: ts.createSourceFile is enough.
 */
import {existsSync, statSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import * as ts from 'typescript'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

const MEASURE_ID = 'relative-import-depth'
const RELATIVE_IMPORT_BUDGET = 0

type BannedClassification = 'relative-cross-package' | 'relative-same-package-deep'

type BannedImport = {
    readonly importer: string
    readonly line: number
    readonly specifier: string
    readonly classification: BannedClassification
}

type ScannableFile = {
    readonly absolutePath: string
    readonly relativePath: string
}

const RESOLUTION_EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.json'] as const

function isInScope(relativePath: string): boolean {
    if (relativePath.startsWith('webapp/src/')) return true
    if (relativePath.startsWith('packages/systems/voicetree-mcp/bin/')) return true
    if (/^packages\/systems\/[^/]+\/src\//.test(relativePath)) return true
    if (/^packages\/libraries\/[^/]+\/src\//.test(relativePath)) return true
    return false
}

type ImportSite = {
    readonly specifier: string
    readonly line: number
}

function extractRelativeImportSites(filePath: string, text: string): ImportSite[] {
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind)
    const sites: ImportSite[] = []

    const record = (literal: ts.StringLiteralLike): void => {
        if (!literal.text.startsWith('.')) return
        const {line} = sf.getLineAndCharacterOfPosition(literal.getStart(sf))
        sites.push({specifier: literal.text, line: line + 1})
    }

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) record(node.moduleSpecifier)
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) record(node.moduleSpecifier)
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [arg] = node.arguments
            if (arg && ts.isStringLiteralLike(arg)) record(arg)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
            record(node.argument.literal)
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const expression = node.moduleReference.expression
            if (ts.isStringLiteralLike(expression)) record(expression)
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
    return sites
}

function parentDirCount(specifier: string): number {
    if (specifier.startsWith('./')) return 0
    const matches = specifier.match(/^(\.\.\/)+/)
    return matches ? matches[0].split('../').length - 1 : 0
}

function resolveRelativeSpecifier(importerPath: string, specifier: string): string {
    const basePath = resolve(dirname(importerPath), specifier)
    const candidates = [
        ...RESOLUTION_EXTENSIONS.map(ext => `${basePath}${ext}`),
        ...RESOLUTION_EXTENSIONS.filter(Boolean).map(ext => join(basePath, `index${ext}`)),
    ]
    return candidates.find(candidate => existsSync(candidate)) ?? basePath
}

const packageRootCache = new Map<string, string>()

function packageRootForPath(path: string): string | null {
    const start = (() => {
        if (existsSync(path)) {
            try {
                return statSync(path).isDirectory() ? path : dirname(path)
            } catch {
                return dirname(path)
            }
        }
        return /\.[a-z0-9]+$/i.test(path) ? dirname(path) : path
    })()
    const cached = packageRootCache.get(start)
    if (cached !== undefined) return cached === '' ? null : cached

    let current = start
    while (true) {
        if (existsSync(join(current, 'package.json'))) {
            packageRootCache.set(start, current)
            return current
        }
        const parent = dirname(current)
        if (parent === current) {
            packageRootCache.set(start, '')
            return null
        }
        current = parent
    }
}

function classifyImportSite(importerPath: string, site: ImportSite): BannedClassification | null {
    const importerPackageRoot = packageRootForPath(importerPath)
    const targetPath = resolveRelativeSpecifier(importerPath, site.specifier)
    const targetPackageRoot = packageRootForPath(targetPath)
    if (importerPackageRoot !== targetPackageRoot) return 'relative-cross-package'
    if (parentDirCount(site.specifier) >= 2) return 'relative-same-package-deep'
    return null
}

async function scanFileForBannedImports(file: ScannableFile): Promise<BannedImport[]> {
    let text: string
    try {
        text = await readFile(file.absolutePath, 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    return extractRelativeImportSites(file.absolutePath, text).flatMap(site => {
        const classification = classifyImportSite(file.absolutePath, site)
        if (!classification) return []
        return [{
            importer: file.relativePath,
            line: site.line,
            specifier: site.specifier,
            classification,
        }]
    })
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const filesByCommunity = new Map<string, ScannableFile[]>()
    for (const community of touched) filesByCommunity.set(community, [])
    for (const file of parsedSubgraph.files) {
        const community = parsedSubgraph.communityMap.get(file.absolutePath)
        if (!community || !touched.has(community)) continue
        if (!isInScope(file.relativePath)) continue
        filesByCommunity.get(community)!.push({
            absolutePath: file.absolutePath,
            relativePath: file.relativePath,
        })
    }

    const bannedByCommunity = new Map<string, BannedImport[]>()
    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        const files = filesByCommunity.get(community) ?? []
        const nested = await Promise.all(files.map(scanFileForBannedImports))
        const flat = nested.flat()
        bannedByCommunity.set(community, flat)
        perCommunity[community] = flat.length
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        const baselineScore = community in baseline ? baseline[community] : null
        if (current > RELATIVE_IMPORT_BUDGET) {
            const examples = bannedByCommunity.get(community)!.slice(0, 3)
            const summary = examples
                .map(b => `${b.importer}:${b.line} ${b.specifier} (${b.classification})`)
                .join('; ')
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `relative-import-depth: ${current} banned relative import(s) in ${community} — ${summary}`,
            })
            continue
        }
        if (baselineScore !== null && current > baselineScore) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `relative-import-depth regressed: ${baselineScore} -> ${current}`,
            })
        }
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const relativeImportDepthMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: false,
    run,
}

registerMeasure(relativeImportDepthMeasure)
