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
            {id: 'session.events', method: 'GET', path: '/sessions/:sessionId/events'},
            {id: 'view.show', method: 'GET', path: '/sessions/:sessionId/state'},
            {id: 'session.folder-state.read', method: 'GET', path: '/sessions/:sessionId/folder-state'},
            {id: 'session.folder-state.set', method: 'PATCH', path: '/sessions/:sessionId/folder-state/:encodedPath'},
            {id: 'session.folder-state.batch', method: 'PATCH', path: '/sessions/:sessionId/folder-state'},
            {id: 'view.selection', method: 'POST', path: '/sessions/:sessionId/selection'},
            {id: 'view.layout', method: 'PUT', path: '/sessions/:sessionId/layout'},
            {id: 'graph.view', method: 'GET', path: '/sessions/:sessionId/view'},
            {id: 'graph.read', method: 'GET', path: '/graph'},
            {id: 'graph.delta', method: 'POST', path: '/graph/delta'},
            {id: 'graph.delete-node', method: 'DELETE', path: '/graph/node/:encodedNodeId'},
            {id: 'vault.show', method: 'GET', path: '/vault'},
            {id: 'vault.open', method: 'POST', path: '/vault/open'},
            {id: 'vault.close', method: 'POST', path: '/vault/close'},
            {id: 'vault.set-write-path', method: 'PUT', path: '/vault/write-path'},
            {id: 'vault.views.list', method: 'GET', path: '/vault/views'},
            {id: 'vault.views.create', method: 'POST', path: '/vault/views'},
            {id: 'vault.views.activate', method: 'POST', path: '/vault/views/:viewId/activate'},
            {id: 'vault.views.clone', method: 'POST', path: '/vault/views/:viewId/clone'},
            {id: 'vault.views.delete', method: 'DELETE', path: '/vault/views/:viewId'},
        ])
        expect(DAEMON_ROUTE_PARITY_EXEMPTIONS).toEqual([
            {
                method: 'GET',
                path: '/sessions/:sessionId/projected-graph',
                reason:
                    '`/sessions/:sessionId/projected-graph` returns the full ProjectedGraph for renderer hydration; internal to the Electron IPC bridge, not a CLI command.',
            },
            {
                method: 'POST',
                path: '/sessions/:sessionId/expand/:folderId',
                reason:
                    '`/sessions/:sessionId/expand/:folderId` stores persistent render-only expand overrides; current CLI uses one-shot `vt graph structure --expand` query params instead.',
            },
            {
                method: 'DELETE',
                path: '/sessions/:sessionId/expand/:folderId',
                reason:
                    '`/sessions/:sessionId/expand/:folderId` clears persistent render-only expand overrides; current CLI has no persistent override command.',
            },
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
            {
                method: 'POST',
                path: '/graph/apply-delta',
                reason:
                    '`/graph/apply-delta` is the option-aware mutation endpoint used by Electron/MCP bridges; the user-facing CLI remains covered by `/graph/delta`.',
            },
            {
                method: 'GET',
                path: '/graph/find-file',
                reason:
                    '`/graph/find-file` is a daemon-internal query used by the webapp IPC bridge for wikilink resolution; not a user-facing CLI command.',
            },
            {
                method: 'GET',
                path: '/graph/preview-contained-nodes/:nodeId',
                reason:
                    '`/graph/preview-contained-nodes/:nodeId` computes context node preview highlights for the renderer; not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/context-node',
                reason:
                    '`/graph/context-node` creates transient agent context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/context-node-from-question',
                reason:
                    '`/graph/context-node-from-question` creates ask-mode context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/context-node-from-selected-nodes',
                reason:
                    '`/graph/context-node-from-selected-nodes` creates transient agent context files for Electron selected-node workflows; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/unseen-nodes-around-context-node',
                reason:
                    '`/graph/unseen-nodes-around-context-node` collects agent context for MCP orchestration; it is not a user-facing CLI command.',
            },
            {
                method: 'PATCH',
                path: '/graph/context-node-contained-ids',
                reason:
                    '`/graph/context-node-contained-ids` updates MCP context-node bookkeeping; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/write-positions',
                reason:
                    '`/graph/write-positions` persists renderer layout coordinates from Electron; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/write-markdown-file',
                reason:
                    '`/graph/write-markdown-file` is the floating markdown editor save endpoint; it writes body text to disk while preserving daemon-owned frontmatter.',
            },
            {
                method: 'POST',
                path: '/graph/undo',
                reason:
                    '`/graph/undo` reverses the last graph mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/redo',
                reason:
                    '`/graph/redo` re-applies a previously undone mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
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
            'vt vault add-read-path',
            'vt vault remove-read-path',
            'vt view collapse',
            'vt view expand',
            'vt graph index',
            'vt graph search',
            'vt graph rename',
            'vt graph mv',
            'vt graph group',
        ])
    })
})
