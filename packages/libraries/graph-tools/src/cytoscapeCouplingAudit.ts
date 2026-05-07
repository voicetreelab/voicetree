import {existsSync, readdirSync, writeFileSync} from 'fs'
import path from 'path'

import {SURFACE_ENTRY_DEFINITIONS} from './cytoscapeSurfaceEntries'
import {type AuditLocation, collectTextMatches, resolveLocation, sortLocations} from './cytoscapeAuditLocationResolver'
import {isProjectionSeam, PROJECTION_SEAM_PATTERNS} from './cytoscapeAuditSeam'
import {renderCytoscapeCouplingCatalogue, renderCytoscapeCouplingAuditSummary} from './cytoscapeAuditRenderer'

export type {AuditLocation} from './cytoscapeAuditLocationResolver'
export {renderCytoscapeCouplingCatalogue, renderCytoscapeCouplingAuditSummary} from './cytoscapeAuditRenderer'

export const CYTOSCAPE_COUPLING_CATALOGUE_RELATIVE_PATH: string =
    'brain/working-memory/tasks/cytoscape-ui-decoupling/coupling-catalogue.md'

export const REQUIRED_COUPLING_SURFACES: readonly string[] = [
    'collapseSet',
    'selection',
    'hover',
    'compound-parent',
    'layout',
    'loaded-roots',
    'F6 aggregation call sites',
    'direct cy.$ reads',
] as const

export const ADDITIONAL_COUPLING_SURFACES: readonly string[] = [
    'shadow-node anchoring',
] as const

const CY_LINE_PATTERN: RegExp = /(^|[^A-Za-z0-9_])(cy|this\.cy)\./
const CY_SELECTOR_PATTERN: RegExp = /(^|[^A-Za-z0-9_])(cy|this\.cy)\.\$(?:id)?\(/
const CYTOSCAPE_IMPORT_PATTERN: RegExp = /^\s*import\b.*['"]cytoscape['"]/
const EXCLUDED_AUDIT_SOURCE_FILES: readonly string[] = [
    'packages/graph-tools/src/cytoscapeCouplingAudit.ts',
    'packages/graph-tools/src/cytoscapeAuditSeam.ts',
    'packages/graph-tools/src/cytoscapeAuditLocationResolver.ts',
    'packages/graph-tools/src/cytoscapeAuditRenderer.ts',
    'packages/graph-tools/src/cytoscapeSurfaceEntries.ts',
] as const

type WorkspaceInfo = {
    readonly name: string
    readonly relativeRoot: string
}

export type PackageImportCount = {
    readonly packageName: string
    readonly count: number
    readonly locations: readonly AuditLocation[]
}

export type SurfaceCatalogueEntry = {
    readonly surface: string
    readonly label: string
    readonly primary: AuditLocation
    readonly owner: string
    readonly consumers: readonly {
        readonly description: string
        readonly location: AuditLocation
    }[]
    readonly mutatesGraphModel: string
    readonly survivesRestart: string
    readonly notes: string
}

export type CytoscapeCouplingAuditReport = {
    readonly repoRoot: string
    readonly catalogueRelativePath: string
    readonly catalogueAbsolutePath: string
    readonly projectionSeamPatterns: readonly string[]
    readonly outsideProjectionSeamCount: number
    readonly outsideProjectionSeamLocations: readonly AuditLocation[]
    readonly cySelectorReadLocations: readonly AuditLocation[]
    readonly packageImportCounts: readonly PackageImportCount[]
    readonly surfaceEntries: readonly SurfaceCatalogueEntry[]
    readonly requiredSurfaces: readonly string[]
    readonly additionalSurfaces: readonly string[]
}

function normalizeRelativePath(filePath: string): string {
    return filePath.split(path.sep).join('/')
}

function isSourceFile(relativePath: string): boolean {
    if (!/\.(ts|tsx)$/.test(relativePath)) {
        return false
    }
    if (relativePath.endsWith('.d.ts')) {
        return false
    }
    if (/\.(test|spec)\.(ts|tsx)$/.test(relativePath)) {
        return false
    }
    return !EXCLUDED_AUDIT_SOURCE_FILES.includes(relativePath)
}

function walkDirectory(absoluteDir: string): string[] {
    const entries: string[] = []
    if (!existsSync(absoluteDir)) {
        return entries
    }
    const stack: string[] = [absoluteDir]
    while (stack.length > 0) {
        const currentDir: string = stack.pop()!
        const dirEntries = readdirSync(currentDir, {withFileTypes: true})
        for (const entry of dirEntries) {
            const absolutePath: string = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                stack.push(absolutePath)
                continue
            }
            entries.push(absolutePath)
        }
    }
    return entries
}

function getWorkspaceInfos(repoRoot: string): readonly WorkspaceInfo[] {
    const infos: WorkspaceInfo[] = [{name: 'webapp', relativeRoot: 'webapp'}]
    const packagesDir: string = path.join(repoRoot, 'packages')
    if (!existsSync(packagesDir)) {
        return infos
    }
    const packageDirs = readdirSync(packagesDir, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    for (const packageDir of packageDirs) {
        infos.push({
            name: `@vt/${packageDir}`,
            relativeRoot: `packages/${packageDir}`,
        })
    }
    return infos
}

function getSourceFiles(repoRoot: string): readonly string[] {
    const workspaceInfos: readonly WorkspaceInfo[] = getWorkspaceInfos(repoRoot)
    const sourceFiles: string[] = []
    for (const workspaceInfo of workspaceInfos) {
        const srcDir: string = path.join(repoRoot, workspaceInfo.relativeRoot, 'src')
        const absoluteFiles: readonly string[] = walkDirectory(srcDir)
        for (const absoluteFile of absoluteFiles) {
            const relativePath: string = normalizeRelativePath(path.relative(repoRoot, absoluteFile))
            if (isSourceFile(relativePath)) {
                sourceFiles.push(relativePath)
            }
        }
    }
    return sourceFiles.sort((left: string, right: string) => left.localeCompare(right))
}

function getPackageNameForPath(relativePath: string): string {
    if (relativePath.startsWith('webapp/')) {
        return 'webapp'
    }
    const match: RegExpMatchArray | null = relativePath.match(/^packages\/([^/]+)\//)
    if (match?.[1]) {
        return `@vt/${match[1]}`
    }
    return 'unknown'
}

export function parseBaselineCountFromCatalogue(markdown: string): number {
    const match: RegExpMatchArray | null = markdown.match(/Outside projection seam `cy\.\*` count: (\d+)/)
    if (!match?.[1]) {
        throw new Error('Could not parse baseline count from coupling catalogue')
    }
    return Number(match[1])
}

export function runCytoscapeCouplingAudit(repoRoot: string): CytoscapeCouplingAuditReport {
    const sourceFiles: readonly string[] = getSourceFiles(repoRoot)
    const workspaceInfos: readonly WorkspaceInfo[] = getWorkspaceInfos(repoRoot)

    const importLocationsByPackage: Map<string, AuditLocation[]> = new Map(
        workspaceInfos.map(info => [info.name, []])
    )

    const outsideProjectionSeamLocations: AuditLocation[] = []
    const cySelectorReadLocations: AuditLocation[] = []

    for (const relativePath of sourceFiles) {
        const importMatches: readonly AuditLocation[] = collectTextMatches(
            repoRoot,
            relativePath,
            CYTOSCAPE_IMPORT_PATTERN,
            {skipBlockComments: true},
        )
        if (importMatches.length > 0) {
            const packageName: string = getPackageNameForPath(relativePath)
            const current: AuditLocation[] = importLocationsByPackage.get(packageName) ?? []
            current.push(...importMatches)
            importLocationsByPackage.set(packageName, current)
        }

        if (isProjectionSeam(relativePath)) {
            continue
        }

        const cyMatches: readonly AuditLocation[] = collectTextMatches(
            repoRoot,
            relativePath,
            CY_LINE_PATTERN,
            {skipBlockComments: true},
        )
        outsideProjectionSeamLocations.push(...cyMatches)

        const cySelectorMatches: readonly AuditLocation[] = collectTextMatches(
            repoRoot,
            relativePath,
            CY_SELECTOR_PATTERN,
            {skipBlockComments: true},
        )
        cySelectorReadLocations.push(...cySelectorMatches)
    }

    const packageImportCounts: readonly PackageImportCount[] = [...importLocationsByPackage.entries()]
        .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
        .map(([packageName, locations]) => ({
            packageName,
            count: locations.length,
            locations: sortLocations(locations),
        }))

    const tryResolve = (lookup: Parameters<typeof resolveLocation>[1]): AuditLocation | null => {
        try { return resolveLocation(repoRoot, lookup) } catch { return null }
    }
    const surfaceEntries: readonly SurfaceCatalogueEntry[] = SURFACE_ENTRY_DEFINITIONS
        .map(d => {
            const primary = tryResolve(d.primary)
            if (primary === null) return null
            const consumers = d.consumers
                .map(c => ({ description: c.description, location: tryResolve(c.ref) }))
                .filter((c): c is { description: string; location: AuditLocation } => c.location !== null)
            return { ...d, primary, consumers }
        })
        .filter((e): e is SurfaceCatalogueEntry => e !== null)

    return {
        repoRoot,
        catalogueRelativePath: CYTOSCAPE_COUPLING_CATALOGUE_RELATIVE_PATH,
        catalogueAbsolutePath: path.join(repoRoot, CYTOSCAPE_COUPLING_CATALOGUE_RELATIVE_PATH),
        projectionSeamPatterns: [...PROJECTION_SEAM_PATTERNS],
        outsideProjectionSeamCount: outsideProjectionSeamLocations.length,
        outsideProjectionSeamLocations: sortLocations(outsideProjectionSeamLocations),
        cySelectorReadLocations: sortLocations(cySelectorReadLocations),
        packageImportCounts,
        surfaceEntries,
        requiredSurfaces: [...REQUIRED_COUPLING_SURFACES],
        additionalSurfaces: [...ADDITIONAL_COUPLING_SURFACES],
    }
}

export function writeCytoscapeCouplingCatalogue(report: CytoscapeCouplingAuditReport): void {
    writeFileSync(report.catalogueAbsolutePath, renderCytoscapeCouplingCatalogue(report))
}
