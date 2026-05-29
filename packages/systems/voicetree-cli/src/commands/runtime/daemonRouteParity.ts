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
    {command: 'vt project show', routeId: 'project.show'},
    {
        command: 'Electron openProject IPC',
        routeId: 'project.open',
        notes: 'Awaitable project lifecycle route consumed by Electron startup and project switching; not exposed as a user-facing CLI command.',
    },
    {
        command: 'Electron closeProject IPC',
        routeId: 'project.close',
        notes: 'Awaitable project lifecycle route consumed by Electron shutdown/switching workflows; not exposed as a user-facing CLI command.',
    },
    {
        command: 'vt project add-read-path',
        routeId: null,
        notes: 'Legacy CLI verb retained until BF-253; BF-247 removed the daemon /project/read-paths route.',
    },
    {
        command: 'vt project remove-read-path',
        routeId: null,
        notes: 'Legacy CLI verb retained until BF-253; BF-247 removed the daemon /project/read-paths route.',
    },
    {command: 'vt project set-write-path', routeId: 'project.set-write-path'},
    {command: 'vt session create', routeId: 'session.create'},
    {command: 'vt session delete', routeId: 'session.delete'},
    {command: 'vt session show', routeId: 'session.show'},
    {
        command: 'vt session events',
        routeId: 'session.events',
        notes: 'SSE stream consumed by the Electron renderer for real-time graph delta notifications; not a user-facing CLI subcommand.',
    },
    {command: 'vt view show', routeId: 'view.show'},
    {
        command: 'vt view set-folder',
        routeId: 'session.folder-state.set',
        notes: 'UFV-2 daemon route for active-view folder visibility; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view set-folder --batch',
        routeId: 'session.folder-state.batch',
        notes: 'UFV-2 daemon route for bulk active-view folder visibility; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view state',
        routeId: 'session.folder-state.read',
        notes: 'UFV-2 daemon route for reading active-view folder visibility; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view list',
        routeId: 'project.views.list',
        notes: 'UFV-2 daemon route for listing named project views; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view create',
        routeId: 'project.views.create',
        notes: 'UFV-2 daemon route for creating named project views; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view switch',
        routeId: 'project.views.activate',
        notes: 'UFV-2 daemon route for switching named project views; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view clone',
        routeId: 'project.views.clone',
        notes: 'UFV-2 daemon route for cloning named project views; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view delete',
        routeId: 'project.views.delete',
        notes: 'UFV-2 daemon route for deleting named project views; CLI verb lands in BF-252.',
    },
    {
        command: 'vt view collapse',
        routeId: null,
        notes: 'Legacy CLI verb retained until BF-253; BF-247 removed the daemon /collapse route in favor of session.folder-state.set.',
    },
    {
        command: 'vt view expand',
        routeId: null,
        notes: 'Legacy CLI verb retained until BF-253; BF-247 removed the daemon /collapse route in favor of session.folder-state.set.',
    },
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
        command: 'vt graph index',
        routeId: null,
        notes: 'Builds the local search index from the project on disk and does not call vt-graphd.',
    },
    {
        command: 'vt graph search',
        routeId: null,
        notes: 'Searches the local index on disk and does not call vt-graphd.',
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
