import {
    DAEMON_ROUTE_PARITY_EXEMPTIONS,
    getDaemonRouteParityRegistry,
    type DaemonRouteId,
} from '@vt/graph-db-server/daemonRouteParity'
import {describe, expect, it, vi, type MockInstance} from 'vitest'
import {runViewCommand} from '../graph-node/view.ts'
import {CliExitError, EXIT} from '../util/exitCodes.ts'
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
            {id: 'project.show', method: 'GET', path: '/project'},
            {id: 'project.open', method: 'POST', path: '/project/open'},
            {id: 'project.close', method: 'POST', path: '/project/close'},
            {id: 'project.set-write-path', method: 'PUT', path: '/project/write-path'},
            {id: 'project.views.list', method: 'GET', path: '/project/views'},
            {id: 'project.views.create', method: 'POST', path: '/project/views'},
            {id: 'project.views.activate', method: 'POST', path: '/project/views/:viewId/activate'},
            {id: 'project.views.clone', method: 'POST', path: '/project/views/:viewId/clone'},
            {id: 'project.views.delete', method: 'DELETE', path: '/project/views/:viewId'},
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
                    '`/graph/apply-delta` is the option-aware mutation endpoint used by Electron/daemon bridges; the user-facing CLI remains covered by `/graph/delta`.',
            },
            {
                method: 'POST',
                path: '/graph/reconcile-disk',
                reason:
                    '`/graph/reconcile-disk` is a daemon maintenance endpoint used by Electron startup/tests to remove stale in-memory nodes for files already gone on disk; it is not a user-facing CLI command.',
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
                    '`/graph/unseen-nodes-around-context-node` collects agent context for agent orchestration; it is not a user-facing CLI command.',
            },
            {
                method: 'PATCH',
                path: '/graph/context-node-contained-ids',
                reason:
                    '`/graph/context-node-contained-ids` updates context-node bookkeeping; it is not a user-facing CLI command.',
            },
            {
                method: 'POST',
                path: '/graph/write-node-layout',
                reason:
                    '`/graph/write-node-layout` persists renderer spatial layout (position + size) from Electron; it is not a user-facing CLI command.',
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
            'vt project add-read-path',
            'vt project remove-read-path',
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

// ────────────────────────────────────────────────────────────────────────
// REC 7: the coverage table must not fabricate `vt view` verbs/flags that
// the real parser (commands/graph-node/view.ts) does not accept. The two historic
// over-claims were a `vt view set-folder --batch` flag and a `vt view state`
// verb; `vt view create` was the same class of fabrication. These tests pin
// the table to the actual `vt view` surface by driving the real command.
// ────────────────────────────────────────────────────────────────────────

describe('vt view coverage labels match the real `vt view` surface', () => {
    it('no longer advertises the fabricated `vt view set-folder --batch` flag', () => {
        const commands: readonly string[] = CLI_DAEMON_ROUTE_COVERAGE.map(
            (entry): string => entry.command,
        )
        expect(commands).not.toContain('vt view set-folder --batch')
        expect(commands.some((command): boolean => command.includes('--batch'))).toBe(false)
    })

    it('no longer advertises the fabricated `vt view state` verb', () => {
        const commands: readonly string[] = CLI_DAEMON_ROUTE_COVERAGE.map(
            (entry): string => entry.command,
        )
        expect(commands).not.toContain('vt view state')
    })

    it('no longer advertises the fabricated `vt view create` verb', () => {
        const commands: readonly string[] = CLI_DAEMON_ROUTE_COVERAGE.map(
            (entry): string => entry.command,
        )
        expect(commands).not.toContain('vt view create')
    })
})

// Drive the public `runViewCommand` to prove, as an observable side effect,
// which `vt view <branch>` tokens the parser actually recognizes. We capture
// the process-boundary I/O (console.log / stderr / process.exit) — the only
// observable surface — rather than mocking any internal collaborator. Each
// probe below is chosen to reject INSIDE the parser, before any daemon
// contact, so the test needs no running vt-graphd.

class ExitCalled extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`)
    }
}

type CommandResult = {
    exitCode: number | null
    stderr: string
}

async function captureViewCommand(argv: string[]): Promise<CommandResult> {
    const stderrChunks: string[] = []
    const logSpy: MockInstance = vi
        .spyOn(console, 'log')
        .mockImplementation((() => {}) as typeof console.log)
    const stderrSpy: MockInstance = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(((chunk: unknown) => {
            stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk))
            return true
        }) as typeof process.stderr.write)
    const exitSpy: MockInstance = vi
        .spyOn(process, 'exit')
        .mockImplementation(((code?: number) => {
            throw new ExitCalled(code ?? 0)
        }) as typeof process.exit)

    let exitCode: number | null = null
    try {
        await runViewCommand(argv)
    } catch (err) {
        if (err instanceof ExitCalled) {
            exitCode = err.code
        } else if (err instanceof CliExitError) {
            stderrChunks.push(`${err.message}\n`)
            exitCode = err.exitCode
        } else {
            throw err
        }
    } finally {
        logSpy.mockRestore()
        stderrSpy.mockRestore()
        exitSpy.mockRestore()
    }

    return {exitCode, stderr: stderrChunks.join('')}
}

/**
 * Per `vt view <branch>` token, an argv that forces the parser to reject
 * BEFORE any daemon contact. A real branch rejects with a branch-specific
 * "missing/too-many argument" message; it never reports the branch itself as
 * an unknown view subcommand. Layout/selection branches report an unknown
 * *layout|selection* subcommand for the junk subcommand — still not an
 * unknown *view* subcommand — and likewise never reach a daemon.
 */
const PRE_DAEMON_BRANCH_PROBES: Record<string, string[]> = {
    list: ['list', '__unexpected_positional__'],
    switch: ['switch'],
    clone: ['clone'],
    delete: ['delete'],
    'set-folder': ['set-folder'],
    selection: ['selection'],
    show: ['show', '__unexpected_positional__'],
    layout: ['layout'],
}

function viewBranchToken(command: string): string | null {
    const prefix = 'vt view '
    if (!command.startsWith(prefix)) {
        return null
    }
    return command.slice(prefix.length).split(' ')[0]
}

describe('every daemon-routed `vt view ...` coverage entry maps to a real parser branch', () => {
    // Only entries that claim a daemon route must name a live `vt view` verb.
    // The `routeId: null` entries (`vt view collapse`/`vt view expand`) are the
    // documented removed-legacy verbs covered by the `getCliCommandsWithoutDaemonRoute`
    // test, so they are intentionally excluded here.
    const viewCommands: readonly string[] = CLI_DAEMON_ROUTE_COVERAGE.flatMap(
        (entry): string[] => {
            if (entry.routeId === null) {
                return []
            }
            const token = viewBranchToken(entry.command)
            return token === null ? [] : [token]
        },
    )

    it('only references branch tokens the parser dispatches on', () => {
        const recognized = new Set(Object.keys(PRE_DAEMON_BRANCH_PROBES))
        const unrecognized = [...new Set(viewCommands)].filter(
            (token): boolean => !recognized.has(token),
        )
        // If this fails, the coverage table advertises a `vt view <token>`
        // command whose token is not a real branch in commands/graph-node/view.ts.
        expect(unrecognized).toEqual([])
    })

    it.each([...new Set(viewCommands)])(
        '`vt view %s` is accepted by the parser (not an unknown view subcommand)',
        async (token: string) => {
            const result = await captureViewCommand(PRE_DAEMON_BRANCH_PROBES[token])
            expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
            expect(result.stderr).not.toMatch(/unknown view subcommand/i)
        },
    )

    it.each([['state'], ['create'], ['batch']])(
        'rejects the fabricated `vt view %s` verb as an unknown view subcommand',
        async (token: string) => {
            const result = await captureViewCommand([token])
            expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
            expect(result.stderr).toMatch(
                new RegExp(`unknown view subcommand: ${token}`, 'i'),
            )
        },
    )

    it('rejects the fabricated `--batch` flag on `set-folder` before any daemon contact', async () => {
        const result = await captureViewCommand([
            'set-folder',
            '/tmp/example',
            'collapsed',
            '--batch',
        ])
        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/unknown argument: --batch/i)
    })
})
