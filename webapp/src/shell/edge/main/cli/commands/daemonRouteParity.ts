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
    {command: 'vt vault show', routeId: 'vault.show'},
    {command: 'vt vault add-read-path', routeId: 'vault.add-read-path'},
    {command: 'vt vault remove-read-path', routeId: 'vault.remove-read-path'},
    {command: 'vt vault set-write-path', routeId: 'vault.set-write-path'},
    {command: 'vt session create', routeId: 'session.create'},
    {command: 'vt session delete', routeId: 'session.delete'},
    {command: 'vt session show', routeId: 'session.show'},
    {command: 'vt view show', routeId: 'view.show'},
    {command: 'vt view collapse', routeId: 'view.collapse'},
    {command: 'vt view expand', routeId: 'view.expand'},
    {command: 'vt view selection set', routeId: 'view.selection'},
    {command: 'vt view selection add', routeId: 'view.selection'},
    {command: 'vt view selection remove', routeId: 'view.selection'},
    {command: 'vt view layout set-pan', routeId: 'view.layout'},
    {command: 'vt view layout set-zoom', routeId: 'view.layout'},
    {command: 'vt view layout set-positions', routeId: 'view.layout'},
    {command: 'vt graph structure', routeId: 'graph.read'},
    {command: 'vt graph view', routeId: 'graph.read'},
    {command: 'vt graph lint', routeId: 'graph.read'},
    {
        command: 'vt graph index',
        routeId: null,
        notes: 'Builds the local search index from the vault on disk and does not call vt-graphd.',
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
