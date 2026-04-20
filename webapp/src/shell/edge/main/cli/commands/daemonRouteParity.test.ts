import {
    DAEMON_ROUTE_PARITY_EXEMPTIONS,
    getDaemonRouteParityRegistry,
    type DaemonRouteId,
} from '@vt/graph-db-server/daemonRouteParity'
import {describe, expect, it} from 'vitest'
import {
    CLI_DAEMON_ROUTE_COVERAGE,
    type CliDaemonRouteCoverageEntry,
    compareDaemonRoutesWithCliCoverage,
    getCliCommandsWithoutDaemonRoute,
} from './daemonRouteParity.ts'

describe('daemon CLI route parity', () => {
    it('keeps the mounted daemon route registry explicit and reviewable', () => {
        expect(getDaemonRouteParityRegistry()).toEqual([
            {id: 'session.create', method: 'POST', path: '/sessions'},
            {id: 'session.delete', method: 'DELETE', path: '/sessions/:sessionId'},
            {id: 'session.show', method: 'GET', path: '/sessions/:sessionId'},
            {id: 'view.show', method: 'GET', path: '/sessions/:sessionId/state'},
            {id: 'view.collapse', method: 'POST', path: '/sessions/:sessionId/collapse/:folderId'},
            {id: 'view.expand', method: 'DELETE', path: '/sessions/:sessionId/collapse/:folderId'},
            {id: 'view.selection', method: 'POST', path: '/sessions/:sessionId/selection'},
            {id: 'view.layout', method: 'PUT', path: '/sessions/:sessionId/layout'},
            {id: 'graph.read', method: 'GET', path: '/graph'},
            {id: 'vault.show', method: 'GET', path: '/vault'},
            {id: 'vault.add-read-path', method: 'POST', path: '/vault/read-paths'},
            {id: 'vault.remove-read-path', method: 'DELETE', path: '/vault/read-paths/:encodedPath'},
            {id: 'vault.set-write-path', method: 'PUT', path: '/vault/write-path'},
        ])
        expect(DAEMON_ROUTE_PARITY_EXEMPTIONS).toEqual([
            {
                method: 'GET',
                path: '/health',
                reason:
                    '`/health` exists for readiness, port discovery, and test orchestration; it is not a user-facing `vt` command.',
            },
            {
                method: 'POST',
                path: '/shutdown',
                reason:
                    '`/shutdown` is daemon lifecycle control for teardown and tests; it is not a user-facing `vt` command.',
            },
        ])
    })

    it('covers every daemon-backed route with structured CLI coverage', () => {
        expect(
            compareDaemonRoutesWithCliCoverage(getDaemonRouteParityRegistry()),
        ).toEqual({
            missingDaemonRouteIds: [],
            staleCliCoverageRouteIds: [],
        })
    })

    it('fails when a daemon route loses CLI coverage', () => {
        const cliCoverage: readonly CliDaemonRouteCoverageEntry[] = CLI_DAEMON_ROUTE_COVERAGE.filter(
            (entry): boolean => entry.routeId !== 'view.layout',
        )

        expect(
            compareDaemonRoutesWithCliCoverage(getDaemonRouteParityRegistry(), cliCoverage),
        ).toEqual({
            missingDaemonRouteIds: ['view.layout'],
            staleCliCoverageRouteIds: [],
        })
    })

    it('fails when CLI coverage points at a nonexistent daemon route', () => {
        const cliCoverage: readonly CliDaemonRouteCoverageEntry[] = [
            ...CLI_DAEMON_ROUTE_COVERAGE,
            {command: 'vt fake drift', routeId: 'view.fake' as DaemonRouteId},
        ]

        expect(
            compareDaemonRoutesWithCliCoverage(getDaemonRouteParityRegistry(), cliCoverage),
        ).toEqual({
            missingDaemonRouteIds: [],
            staleCliCoverageRouteIds: ['view.fake'],
        })
    })

    it('documents graph subcommands that intentionally remain outside daemon parity', () => {
        expect(getCliCommandsWithoutDaemonRoute()).toEqual([
            'vt graph index',
            'vt graph search',
            'vt graph rename',
            'vt graph mv',
        ])
    })
})
