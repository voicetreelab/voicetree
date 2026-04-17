import {existsSync, readdirSync, readFileSync, writeFileSync} from 'fs'
import path from 'path'

import { SURFACE_ENTRY_DEFINITIONS, type LocationLookup } from './cytoscapeSurfaceEntries'

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

const PROJECTION_SEAM_PATTERNS: readonly string[] = [
    'webapp/src/shell/UI/**',
    'webapp/src/shell/web/**',
    'webapp/src/utils/responsivePadding.ts',
    'webapp/src/utils/visibleViewport.ts',
    'webapp/src/utils/viewportVisibility.ts',
] as const

const CY_LINE_PATTERN: RegExp = /(^|[^A-Za-z0-9_])(cy|this\.cy)\./
const CY_SELECTOR_PATTERN: RegExp = /(^|[^A-Za-z0-9_])(cy|this\.cy)\.\$(?:id)?\(/
const CYTOSCAPE_IMPORT_PATTERN: RegExp = /^\s*import\b.*['"]cytoscape['"]/
const COMMENT_ONLY_RATCHET_PATTERN: RegExp = /^\/\/\s*(cy|this\.cy)\./
const EXCLUDED_AUDIT_SOURCE_FILES: readonly string[] = [
    'packages/graph-tools/src/cytoscapeCouplingAudit.ts',
    'packages/graph-tools/src/cytoscapeSurfaceEntries.ts',
] as const

type WorkspaceInfo = {
    readonly name: string
    readonly relativeRoot: string
}

export type AuditLocation = {
    readonly relativePath: string
    readonly absolutePath: string
    readonly lineNumber: number
    readonly snippet: string
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

function trimSnippet(snippet: string, maxLength: number = 140): string {
    const trimmed: string = snippet.trim()
    if (trimmed.length <= maxLength) {
        return trimmed
    }
    return `${trimmed.slice(0, maxLength - 3)}...`
}

function escapeTableCell(value: string): string {
    return value.replace(/\|/g, '\\|')
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

function isTestScaffolding(relativePath: string): boolean {
    return (
        relativePath.includes('/__tests__/')
        || relativePath.includes('/integration-tests/')
        || relativePath.includes('/test-utils/')
    )
}

function isProjectionSeam(relativePath: string): boolean {
    return (
        relativePath.startsWith('webapp/src/shell/UI/')
        || relativePath.startsWith('webapp/src/shell/web/')
        || relativePath === 'webapp/src/utils/responsivePadding.ts'
        || relativePath === 'webapp/src/utils/visibleViewport.ts'
        || relativePath === 'webapp/src/utils/viewportVisibility.ts'
        || relativePath === 'webapp/src/shell/edge/UI-edge/graph/applyLiveCommandToRenderer.ts'
        || isTestScaffolding(relativePath)
    )
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

function splitLines(content: string): readonly string[] {
    return content.split(/\r?\n/)
}

function collectTextMatches(
    repoRoot: string,
    relativePath: string,
    pattern: RegExp,
    options: {
        readonly skipBlockComments?: boolean
    } = {},
): readonly AuditLocation[] {
    const absolutePath: string = path.join(repoRoot, relativePath)
    const lines: readonly string[] = splitLines(readFileSync(absolutePath, 'utf-8'))
    const matches: AuditLocation[] = []
    let inBlockComment: boolean = false
    for (let index: number = 0; index < lines.length; index += 1) {
        const line: string = lines[index]
        const trimmed: string = line.trim()

        if (options.skipBlockComments === true) {
            if (inBlockComment) {
                if (trimmed.includes('*/')) {
                    inBlockComment = false
                }
                continue
            }
            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) {
                    inBlockComment = true
                }
                continue
            }
        }

        if (
            options.skipBlockComments === true
            && trimmed.startsWith('//')
            && COMMENT_ONLY_RATCHET_PATTERN.test(trimmed) === false
        ) {
            continue
        }

        pattern.lastIndex = 0
        if (!pattern.test(line)) {
            continue
        }

        matches.push({
            relativePath,
            absolutePath,
            lineNumber: index + 1,
            snippet: trimSnippet(line),
        })
    }
    return matches
}

function resolveLocation(repoRoot: string, lookup: LocationLookup): AuditLocation {
    const absolutePath: string = path.join(repoRoot, lookup.relativePath)
    const lines: readonly string[] = splitLines(readFileSync(absolutePath, 'utf-8'))
    const targetOccurrence: number = lookup.occurrence ?? 1
    let currentOccurrence: number = 0
    for (let index: number = 0; index < lines.length; index += 1) {
        if (!lines[index].includes(lookup.contains)) {
            continue
        }
        currentOccurrence += 1
        if (currentOccurrence !== targetOccurrence) {
            continue
        }
        return {
            relativePath: lookup.relativePath,
            absolutePath,
            lineNumber: index + 1,
            snippet: trimSnippet(lines[index]),
        }
    }
    throw new Error(`Could not resolve ${lookup.relativePath} containing "${lookup.contains}"`)
}

function sortLocations(locations: readonly AuditLocation[]): readonly AuditLocation[] {
    return [...locations].sort((left: AuditLocation, right: AuditLocation) => {
        const pathCompare: number = left.relativePath.localeCompare(right.relativePath)
        if (pathCompare !== 0) {
            return pathCompare
        }
        return left.lineNumber - right.lineNumber
    })
}

function groupLocationsByFile(locations: readonly AuditLocation[]): ReadonlyMap<string, readonly AuditLocation[]> {
    const grouped: Map<string, AuditLocation[]> = new Map()
    for (const location of locations) {
        const bucket: AuditLocation[] = grouped.get(location.relativePath) ?? []
        bucket.push(location)
        grouped.set(location.relativePath, bucket)
    }
    const sortedEntries: [string, readonly AuditLocation[]][] = [...grouped.entries()]
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([relativePath, bucket]) => [relativePath, sortLocations(bucket)])
    return new Map(sortedEntries)
}

function formatLocationLink(location: AuditLocation): string {
    return `[${location.relativePath}:${location.lineNumber}](<${location.absolutePath}:${location.lineNumber}>)`
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

    const surfaceEntries: readonly SurfaceCatalogueEntry[] = SURFACE_ENTRY_DEFINITIONS.map(definition => ({
        surface: definition.surface,
        label: definition.label,
        primary: resolveLocation(repoRoot, definition.primary),
        owner: definition.owner,
        consumers: definition.consumers.map(consumer => ({
            description: consumer.description,
            location: resolveLocation(repoRoot, consumer.ref),
        })),
        mutatesGraphModel: definition.mutatesGraphModel,
        survivesRestart: definition.survivesRestart,
        notes: definition.notes,
    }))

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

export function renderCytoscapeCouplingCatalogue(report: CytoscapeCouplingAuditReport): string {
    const lines: string[] = []
    const groupedOutsideProjectionLocations: ReadonlyMap<string, readonly AuditLocation[]> =
        groupLocationsByFile(report.outsideProjectionSeamLocations)

    lines.push('# Cytoscape Coupling Catalogue')
    lines.push('')
    lines.push('Generated by `npx tsx packages/graph-tools/scripts/audit-cytoscape-coupling.ts --write-catalogue`.')
    lines.push('')
    lines.push('## Baseline')
    lines.push(`- Outside projection seam \`cy.*\` count: ${report.outsideProjectionSeamCount}`)
    lines.push(`- Catalogue path: \`${report.catalogueRelativePath}\``)
    lines.push(`- Named surfaces audited: ${report.requiredSurfaces.join(', ')}`)
    lines.push(`- Additional surfaces flagged: ${report.additionalSurfaces.join(', ')}`)
    lines.push('')
    lines.push('## Projection Seam')
    for (const seamPattern of report.projectionSeamPatterns) {
        lines.push(`- \`${seamPattern}\``)
    }
    lines.push('')
    lines.push('## Cytoscape Imports By Package')
    lines.push('| Package | Count | Locations |')
    lines.push('| --- | ---: | --- |')
    for (const packageImportCount of report.packageImportCounts) {
        const renderedLocations: string = packageImportCount.locations.length === 0
            ? 'none'
            : packageImportCount.locations.map(formatLocationLink).join('<br>')
        lines.push(
            `| ${escapeTableCell(packageImportCount.packageName)} | ${packageImportCount.count} | ${renderedLocations} |`
        )
    }
    lines.push('')
    lines.push('## Outside Projection Seam `cy.*` Inventory')
    for (const [relativePath, locations] of groupedOutsideProjectionLocations.entries()) {
        lines.push(`### \`${relativePath}\` (${locations.length})`)
        for (const location of locations) {
            lines.push(`- ${formatLocationLink(location)} - \`${location.snippet}\``)
        }
        lines.push('')
    }
    lines.push('## Surface Catalogue')
    lines.push('| Surface | Reference | Current owner | Current consumer(s) | Mutates graph-model? | Survives restart? | Notes |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const surfaceEntry of report.surfaceEntries) {
        const renderedConsumers: string = surfaceEntry.consumers
            .map(consumer => `${escapeTableCell(consumer.description)} (${formatLocationLink(consumer.location)})`)
            .join('<br>')
        lines.push(
            `| ${escapeTableCell(`${surfaceEntry.surface}: ${surfaceEntry.label}`)} | ${formatLocationLink(surfaceEntry.primary)} | ${escapeTableCell(surfaceEntry.owner)} | ${renderedConsumers} | ${escapeTableCell(surfaceEntry.mutatesGraphModel)} | ${escapeTableCell(surfaceEntry.survivesRestart)} | ${escapeTableCell(surfaceEntry.notes)} |`
        )
    }
    return lines.join('\n').trimEnd() + '\n'
}

export function renderCytoscapeCouplingAuditSummary(report: CytoscapeCouplingAuditReport): string {
    const lines: string[] = []
    lines.push(`Outside projection seam count: ${report.outsideProjectionSeamCount}`)
    lines.push(`Catalogue: ${report.catalogueAbsolutePath}`)
    lines.push('Projection seam:')
    for (const seamPattern of report.projectionSeamPatterns) {
        lines.push(`- ${seamPattern}`)
    }
    lines.push('Cytoscape imports by package:')
    for (const packageImportCount of report.packageImportCounts) {
        lines.push(`- ${packageImportCount.packageName}: ${packageImportCount.count}`)
    }
    lines.push('Named surfaces:')
    for (const surface of report.requiredSurfaces) {
        lines.push(`- ${surface}`)
    }
    lines.push('Additional surfaces:')
    for (const surface of report.additionalSurfaces) {
        lines.push(`- ${surface}`)
    }
    lines.push('Outside projection seam callsites:')
    for (const location of report.outsideProjectionSeamLocations) {
        lines.push(`- ${location.relativePath}:${location.lineNumber} ${location.snippet}`)
    }
    return lines.join('\n')
}

export function writeCytoscapeCouplingCatalogue(report: CytoscapeCouplingAuditReport): void {
    writeFileSync(report.catalogueAbsolutePath, renderCytoscapeCouplingCatalogue(report))
}
