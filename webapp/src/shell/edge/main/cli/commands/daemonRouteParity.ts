import type {
    DaemonRouteId,
    NormalizedDaemonRoute,
} from '@vt/graph-db-server/daemonRouteParity'

export type CliDaemonRouteCoverageEntry = {
    command: string
    notes?: string
    routeId: DaemonRouteId | null
}

export type DaemonCliParityReport = {
    missingDaemonRouteIds: readonly DaemonRouteId[]
    staleCliCoverageRouteIds: readonly DaemonRouteId[]
}

export const CLI_DAEMON_ROUTE_COVERAGE: readonly CliDaemonRouteCoverageEntry[] = [
    {
        command: 'MCP create_graph context-node creation',
        routeId: 'context-nodes.create',
        notes: 'Used by daemon-backed context node creation flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'MCP request_context from question',
        routeId: 'context-nodes.create-from-question',
        notes: 'Used by MCP/agent context-node flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'MCP request_context from selection',
        routeId: 'context-nodes.create-from-selection',
        notes: 'Used by MCP/agent context-node flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'MCP get_unseen_nodes_nearby',
        routeId: 'context-nodes.unseen-nearby',
        notes: 'Also surfaced through `vt graph unseen` via the MCP bridge.',
    },
    {
        command: 'MCP update context contained IDs',
        routeId: 'context-nodes.update-contained-ids',
        notes: 'Used by MCP/agent context-node maintenance flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron context preview',
        routeId: 'context-nodes.preview-contained',
        notes: 'Used by the Electron main process to preview context-node containment.',
    },
    {command: 'vt vault show', routeId: 'vault.show'},
    {command: 'vt vault add-read-path', routeId: 'vault.add-read-path'},
    {command: 'vt vault remove-read-path', routeId: 'vault.remove-read-path'},
    {command: 'vt vault set-write-path', routeId: 'vault.set-write-path'},
    {
        command: 'Electron vault load-and-merge',
        routeId: 'vault.load-and-merge',
        notes: 'Used by daemon-backed vault loading flows rather than a direct user-facing CLI subcommand.',
    },
    {command: 'vt session create', routeId: 'session.create'},
    {command: 'vt session delete', routeId: 'session.delete'},
    {command: 'vt session show', routeId: 'session.show'},
    {
        command: 'vt session events',
        routeId: 'session.events',
        notes: 'SSE stream consumed by the Electron renderer for real-time graph delta notifications; not a user-facing CLI subcommand.',
    },
    {command: 'vt view show', routeId: 'view.show'},
    {command: 'vt view collapse', routeId: 'view.collapse'},
    {command: 'vt view expand', routeId: 'view.expand'},
    {command: 'vt view selection set', routeId: 'view.selection'},
    {command: 'vt view selection add', routeId: 'view.selection'},
    {command: 'vt view selection remove', routeId: 'view.selection'},
    {command: 'vt view layout set-pan', routeId: 'view.layout'},
    {command: 'vt view layout set-zoom', routeId: 'view.layout'},
    {command: 'vt view layout set-positions', routeId: 'view.layout'},
    {command: 'vt graph structure', routeId: 'graph.view'},
    {command: 'vt graph view', routeId: 'graph.view'},
    {command: 'vt graph lint', routeId: 'graph.read'},
    {command: 'vt graph create', routeId: 'graph.delta'},
    {command: 'vt graph delete-node', routeId: 'graph.delete-node'},
    {
        command: 'Electron undo',
        routeId: 'graph.undo',
        notes: 'Used by daemon-backed Electron undo flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron redo',
        routeId: 'graph.redo',
        notes: 'Used by daemon-backed Electron redo flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron persist graph positions',
        routeId: 'graph.positions',
        notes: 'Used during daemon-backed app shutdown and renderer position persistence.',
    },
    {
        command: 'Electron reload graph',
        routeId: 'graph.reload',
        notes: 'Used by daemon-backed graph reload flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'vt graph index',
        routeId: 'search.build-index',
    },
    {
        command: 'vt graph search',
        routeId: 'search.nodes',
    },
    {
        command: 'Electron file search',
        routeId: 'search.file',
        notes: 'Used by daemon-backed file lookup flows rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron get watched project root',
        routeId: 'watch.project-root-read',
        notes: 'Used by daemon-backed watch-folder state reads rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron set watched project root',
        routeId: 'watch.project-root-write',
        notes: 'Used by daemon-backed watch-folder state writes rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'Electron watch status',
        routeId: 'watch.status',
        notes: 'Used by daemon-backed watch-folder status checks rather than a direct user-facing CLI subcommand.',
    },
    {
        command: 'vt graph rename',
        routeId: null,
        notes: 'Runs through @vt/graph-tools filesystem helpers and does not call vt-graphd.',
    },
    {
        command: 'vt graph mv',
        routeId: null,
        notes: 'Runs through @vt/graph-tools filesystem helpers and does not call vt-graphd.',
    },
    {
        command: 'vt graph group',
        routeId: null,
        notes: 'Runs through @vt/graph-tools filesystem helpers and does not call vt-graphd.',
    },
] as const satisfies readonly CliDaemonRouteCoverageEntry[]

function sortedRouteIds(routeIds: Iterable<DaemonRouteId>): readonly DaemonRouteId[] {
    return [...routeIds].sort((left, right) => left.localeCompare(right))
}

export function getCliDaemonCoveredRouteIds(
    cliCoverage: readonly CliDaemonRouteCoverageEntry[] = CLI_DAEMON_ROUTE_COVERAGE,
): readonly DaemonRouteId[] {
    return sortedRouteIds(
        new Set(
            cliCoverage.flatMap((entry): DaemonRouteId[] =>
                entry.routeId === null ? [] : [entry.routeId],
            ),
        ),
    )
}

export function getCliCommandsWithoutDaemonRoute(
    cliCoverage: readonly CliDaemonRouteCoverageEntry[] = CLI_DAEMON_ROUTE_COVERAGE,
): readonly string[] {
    return cliCoverage
        .filter((entry): boolean => entry.routeId === null)
        .map((entry): string => entry.command)
}

export function compareDaemonRoutesWithCliCoverage(
    daemonRoutes: readonly Pick<NormalizedDaemonRoute, 'id'>[],
    cliCoverage: readonly CliDaemonRouteCoverageEntry[] = CLI_DAEMON_ROUTE_COVERAGE,
): DaemonCliParityReport {
    const daemonRouteIds: Set<DaemonRouteId> = new Set(
        daemonRoutes.map((route): DaemonRouteId => route.id),
    )
    const cliRouteIds: Set<DaemonRouteId> = new Set(getCliDaemonCoveredRouteIds(cliCoverage))

    return {
        missingDaemonRouteIds: sortedRouteIds(
            [...daemonRouteIds].filter((routeId): boolean => !cliRouteIds.has(routeId)),
        ),
        staleCliCoverageRouteIds: sortedRouteIds(
            [...cliRouteIds].filter((routeId): boolean => !daemonRouteIds.has(routeId)),
        ),
    }
}
