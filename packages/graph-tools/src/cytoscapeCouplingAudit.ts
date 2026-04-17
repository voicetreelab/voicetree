import {existsSync, readdirSync, readFileSync, writeFileSync} from 'fs'
import path from 'path'

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
] as const

type WorkspaceInfo = {
    readonly name: string
    readonly relativeRoot: string
}

type LocationLookup = {
    readonly relativePath: string
    readonly contains: string
    readonly occurrence?: number
}

type SurfaceEntryDefinition = {
    readonly surface: string
    readonly label: string
    readonly primary: LocationLookup
    readonly owner: string
    readonly consumers: readonly {
        readonly description: string
        readonly ref: LocationLookup
    }[]
    readonly mutatesGraphModel: string
    readonly survivesRestart: string
    readonly notes: string
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

const SURFACE_ENTRY_DEFINITIONS: readonly SurfaceEntryDefinition[] = [
    {
        surface: 'collapseSet',
        label: 'graphCollapsedFolders renderer store',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/state/FolderTreeStore.ts',
            contains: 'readonly graphCollapsedFolders: ReadonlySet<string>;',
        },
        owner: 'Renderer FolderTreeStore state',
        consumers: [
            {
                description: 'folder collapse toggle mutates the set',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'addCollapsedFolder(folderId)',
                },
            },
            {
                description: 'delta projection snapshots collapsed folders during folder materialization',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: '...getFolderTreeState().graphCollapsedFolders,',
                },
            },
            {
                description: 'folder tree sidebar renders the graph-collapse affordance from the set',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/folderTree/FolderTreeNode.tsx',
                    contains: 'const isGraphCollapsed: boolean = graphFolderId !== null && graphCollapsedFolders.has(graphFolderId);',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Only sidebar open/width persist in localStorage; graphCollapsedFolders resets on restart.',
    },
    {
        surface: 'selection',
        label: 'Cytoscape-owned node selection',
        primary: {
            relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
            contains: "const selectedNodes: CollectionReturnValue = cy.$('node:selected');",
        },
        owner: 'Cytoscape internal selection state',
        consumers: [
            {
                description: 'search navigation clears and re-selects through cy selectors',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/navigation/GraphNavigationService.ts',
                    contains: "cy.$(':selected').unselect();",
                    occurrence: 1,
                },
            },
            {
                description: 'floating window focus re-selects the owning graph node',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/select-floating-window-node.ts',
                    contains: "cy.$(':selected').unselect();",
                },
            },
            {
                description: 'graph hotkeys derive their target set from cy.$(:selected)',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/actions/graphActions.ts',
                    contains: "return cy.$(':selected')",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Selection is session-only and is read/written directly through Cytoscape selectors plus node.select()/unselect().',
    },
    {
        surface: 'hover',
        label: 'Cytoscape hover classes + hover-editor-open flags',
        primary: {
            relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
            contains: "cy.on('mouseover', 'node', (e) => {",
        },
        owner: 'Cytoscape node classes plus hover editor/image viewer UI state',
        consumers: [
            {
                description: 'hover editor toggles the hover-editor-open class on graph nodes',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/editors/HoverEditor.ts',
                    contains: "cy.getElementById(nodeId).addClass('hover-editor-open');",
                },
            },
            {
                description: 'node stylesheet reacts to the hover class',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/defaultNodeStyles.ts',
                    contains: "selector: 'node.hover',",
                },
            },
            {
                description: 'frontmatter rules blank labels while hover editors are open',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/frontmatterStyles.ts',
                    contains: "selector: 'node.hover-editor-open[label]',",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Hover is purely renderer-local; both the hover class and hover-editor-open class are transient UI state.',
    },
    {
        surface: 'compound-parent',
        label: 'Folder/file parentage stored as Cytoscape compound data',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
            contains: 'parent: folderPath ?? undefined',
        },
        owner: 'Cytoscape compound parent data on folder and child nodes',
        consumers: [
            {
                description: 'folder expand reconstructs subfolder compounds and child parent pointers',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'parent: folderId,',
                },
            },
            {
                description: 'node styling treats folder parents as compounds',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/services/defaultNodeStyles.ts',
                    contains: "selector: 'node[?isFolderNode]',",
                },
            },
            {
                description: 'layout participation logic branches on collapsed folder compounds',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/layoutParticipation.ts',
                    contains: "return !node.data('isFolderNode') || Boolean(node.data('collapsed'));",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'Yes (derived)',
        notes: 'The compound parent relation is re-derived from file/folder paths during projection instead of being stored separately.',
    },
    {
        surface: 'layout',
        label: 'Node positions persisted back into graph-model metadata',
        primary: {
            relativePath: 'webapp/src/shell/edge/main/saveNodePositions.ts',
            contains: 'position: O.some(pos)',
        },
        owner: 'Main-process graph store GraphNode.nodeUIMetadata.position',
        consumers: [
            {
                description: 'drag release saves current Cytoscape positions',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts',
                    contains: 'void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);',
                },
            },
            {
                description: 'auto-layout writes back the post-layout positions',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout.ts',
                    contains: 'void window.electronAPI?.main.saveNodePositions(cy.nodes().jsons() as NodeDefinition[]);',
                },
            },
            {
                description: 'delta projection hydrates node positions from metadata when nodes are created',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: 'position: {',
                    occurrence: 1,
                },
            },
        ],
        mutatesGraphModel: 'Yes',
        survivesRestart: 'Partial',
        notes: 'Positions flow back into graph-model state immediately, but the file comment notes disk durability is deferred until a later save path writes the node.',
    },
    {
        surface: 'layout',
        label: 'Viewport + pending-pan renderer state',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/state/PendingPanStore.ts',
            contains: 'let pendingPan: PendingPanState | null = null;',
        },
        owner: 'Renderer module-level pending-pan state plus per-window viewport snapshots',
        consumers: [
            {
                description: 'auto-layout consumes pending pan after layout completion',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout.ts',
                    contains: 'panToTrackedNode(cy);',
                },
            },
            {
                description: 'floating-window fullscreen stores and restores zoom/pan',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/fullscreen-zoom.ts',
                    contains: 'windowViewportStates.set(shadowNodeId, { zoom: cy.zoom(), pan: { ...cy.pan() } });',
                },
            },
            {
                description: 'gesture navigation mutates the live viewport through panBy/zoom',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/navigation/NavigationGestureService.ts',
                    contains: 'this.cy.panBy({ x: -e.deltaX, y: -e.deltaY });',
                    occurrence: 1,
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Viewport zoom/pan and pending pan intents are ephemeral renderer concerns today.',
    },
    {
        surface: 'loaded-roots',
        label: 'Persisted writePath/readPaths vault config',
        primary: {
            relativePath: 'packages/graph-model/src/watch-folder/vault-allowlist.ts',
            contains: 'export async function getVaultPaths(): Promise<readonly FilePath[]> {',
        },
        owner: '@vt/graph-model watch-folder config file',
        consumers: [
            {
                description: 'broadcast pushes the persisted vault state into the renderer mirror',
                ref: {
                    relativePath: 'packages/graph-model/src/watch-folder/broadcast-vault-state.ts',
                    contains: 'getCallbacks().syncVaultState?.({ readPaths, writePath, starredFolders });',
                },
            },
            {
                description: 'delta projection maps node ids back to currently loaded roots',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: 'const { writePath, readPaths } = getVaultState()',
                },
            },
            {
                description: 'vault-path subscription forces a full layout reset when loaded roots change',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts',
                    contains: 'const vaultPathSubscription: () => void = subscribeToVaultPaths((state: VaultPathState) => {',
                },
            },
        ],
        mutatesGraphModel: 'Yes',
        survivesRestart: 'Yes',
        notes: 'writePath/readPaths are persisted in vault config and drive graph load/unload plus renderer topology changes.',
    },
    {
        surface: 'F6 aggregation call sites',
        label: 'Synthetic edge aggregation for collapsed folders',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
            contains: 'const specs: readonly SyntheticEdgeSpec[] = computeSyntheticEdgeSpecs(folderId, descendantIds, connectedEdges)',
        },
        owner: 'Collapsed-folder projection logic plus synthetic-edge registry',
        consumers: [
            {
                description: 'delta projection patches aggregated edges when hidden descendants receive updates',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/applyGraphDeltaToUI.ts',
                    contains: "addOrUpdateSyntheticEdge(cy, collapsedFolder, 'outgoing', edge.targetId, {",
                },
            },
            {
                description: 'layout excludes synthetic edges from participant sets',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/layoutParticipation.ts',
                    contains: "if (edge.data('isIndicatorEdge') || edge.data('isSyntheticEdge')) return false;",
                },
            },
            {
                description: 'folder expand replays synthetic edges for still-collapsed descendants',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/folderCollapse.ts',
                    contains: 'addOrUpdateSyntheticEdge(cy, se.folderId, se.direction, se.externalId, se.original)',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'Synthetic edges are projection-only today; they are regenerated from live collapse state instead of persisted as graph-model data.',
    },
    {
        surface: 'direct cy.$ reads',
        label: 'Selector-based reads against live Cytoscape state',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/graph/navigation/GraphNavigationService.ts',
            contains: "cy.$(':selected').unselect();",
            occurrence: 1,
        },
        owner: 'Cytoscape selector engine and internal element sets',
        consumers: [
            {
                description: 'active-terminal highlight clears and reapplies CSS classes via cy selectors',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/graph/setupViewSubscriptions.ts',
                    contains: "cy.$('.' + TERMINAL_ACTIVE_CLASS).removeClass(TERMINAL_ACTIVE_CLASS);",
                },
            },
            {
                description: 'context highlighting uses cy.$id for contained node fanout',
                ref: {
                    relativePath: 'webapp/src/shell/UI/cytoscape-graph-ui/highlightContextNodes.ts',
                    contains: 'cy.$id(id).addClass(CONTEXT_CONTAINED_CLASS);',
                    occurrence: 1,
                },
            },
            {
                description: 'close-selected-window reads the selected set directly from cy',
                ref: {
                    relativePath: 'webapp/src/shell/UI/views/closeSelectedWindow.ts',
                    contains: "const selected: cytoscape.CollectionReturnValue = cy.$(':selected');",
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'The selector reads are scattered across edge/UI modules and couple business logic to Cytoscape internals.',
    },
    {
        surface: 'shadow-node anchoring',
        label: 'Floating-window shadow nodes and viewport restore state',
        primary: {
            relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts',
            contains: 'const shadowNode: cytoscape.CollectionReturnValue = cy.add({',
        },
        owner: 'Cytoscape shadow nodes plus floating-window DOM datasets',
        consumers: [
            {
                description: 'terminal creation anchors windows by minting shadow nodes in the graph',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/terminals/createFloatingTerminal.ts',
                    contains: 'anchorToNode(cy, terminalWithUI, getCurrentIndex(cy));',
                },
            },
            {
                description: 'fullscreen zoom stores per-shadow-node viewport state',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/fullscreen-zoom.ts',
                    contains: 'windowViewportStates.set(shadowNodeId, { zoom: cy.zoom(), pan: { ...cy.pan() } });',
                },
            },
            {
                description: 'drag handlers write shadow-node positions back into Cytoscape',
                ref: {
                    relativePath: 'webapp/src/shell/edge/UI-edge/floating-windows/anchor-to-node.ts',
                    contains: 'shadowNode.position({ x: graphX, y: graphY });',
                },
            },
        ],
        mutatesGraphModel: 'No',
        survivesRestart: 'No',
        notes: 'This is an additional coupling surface beyond the kanban list: floating windows currently materialize extra Cytoscape nodes and edges that only exist for UI anchoring.',
    },
] as const

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
