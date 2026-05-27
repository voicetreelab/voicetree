#!/usr/bin/env -S node --import tsx
// vt-mcpd: headless MCP daemon. Embeds graph-db-server + voicetree-mcp in one
// Node process, with no Electron dependency. Lifecycle:
//   1. Parse --vault (required) and --port (optional MCP start port).
//   2. Wire @vt/agent-runtime + @vt/voicetree-mcp late-bound bridges for headless mode.
//   3. Start graph-db-server in-process via startDaemon (loads graph, mounts watcher,
//      publishes graphd.port, owns the per-vault lock).
//   4. Start MCP HTTP server (publishes .mcp.json with the assigned port).
//   5. Wait for SIGINT/SIGTERM, then tear down: MCP server → terminals → graph-db.
//
// Headless contract (decided in Phase E; see docs/headless-migration.md):
//   - READ path:  CLI agents call any read tool over MCP (graph_structure,
//                 get_unseen_nodes_nearby, …). These do not require a terminal
//                 record on the daemon side.
//   - WRITE path: CLI agents write new nodes by raw filesystem Write into the
//                 watched vault; the chokidar mount inside startDaemon
//                 reconciles them into the graph-store singleton.
// `create_graph` (and other write tools) validate `callerTerminalId` against
// getTerminalRecords(), which vt-mcpd intentionally seeds empty in headless
// mode — so a CLI agent invoking create_graph receives a clean
// "Unknown caller terminal: <id>" MCP error rather than silent corruption.
// Bootstrapping a synthetic terminal record was rejected: the registry models
// real PTY/agent processes with budget + lifecycle; a synthetic terminal has
// no real owner. Phase D (phase-d-headless-e2e-result.md) verified the
// Write→watcher path end-to-end.

import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {tracing} from '@vt/observability'
import {
    configureMcpServer,
    getMcpPort,
    registerChildIfMonitored,
    startMcpServer,
    type McpServerHandle,
} from '@vt/voicetree-mcp'
import {agentRuntime, configureAgentRuntime} from '@vt/agent-runtime'

interface Args {
    readonly vault: string
    readonly port?: number
}

function die(msg: string): never {
    process.stderr.write(`vt-mcpd: ${msg}\n`)
    process.exit(1)
}

function parseArgs(argv: readonly string[]): Args {
    let vault: string | null = null
    let port: number | undefined
    for (let i: number = 0; i < argv.length; i++) {
        const a: string = argv[i]
        if (a === '--vault') {
            vault = argv[++i] ?? null
        } else if (a === '--port') {
            const v: string | undefined = argv[++i]
            const n: number = Number.parseInt(v ?? '', 10)
            if (!Number.isInteger(n) || n < 0 || n > 65535) {
                die(`invalid --port: ${v}`)
            }
            port = n
        } else if (a === '--help' || a === '-h') {
            process.stdout.write('Usage: vt-mcpd --vault <path> [--port <n>]\n')
            process.exit(0)
        } else {
            die(`unknown argument: ${a}`)
        }
    }
    if (!vault) die('missing required --vault <path>')
    return {vault: resolve(vault!), port}
}

function defaultAppSupportPath(): string {
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'Voicetree')
    }
    if (process.platform === 'win32') {
        return join(
            process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
            'Voicetree',
        )
    }
    return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
        'Voicetree',
    )
}

function configureHeadlessBridges(appSupportPath: string, vault: string): void {
    // Live-state tools require an Electron renderer; fail with a clear MCP error
    // rather than crashing the daemon.
    configureMcpServer({
        liveState: {
            applyLiveCommand: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_dispatch_live_command requires an Electron renderer. Not available in headless vt-mcpd.',
                )),
            getLiveStateSnapshot: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_get_live_state requires an Electron renderer. Not available in headless vt-mcpd.',
                )),
        },
        // search bridge omitted: search_nodes returns "Search backend is not configured."
    })

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => appSupportPath,
            getMcpPort,
            getProjectRoot: async (): Promise<string> => vault,
            getVaultSnapshot: async () => ({
                projectRoot: vault,
                readPaths: [vault],
                writeFolder: vault,
            }),
            getWriteFolder: async (): Promise<string> => vault,
        },
        // No interactive terminals in headless mode; only registerChildIfMonitored
        // is reachable (used by the spawn path even for headless agents).
        ui: {
            registerChildIfMonitored,
        },
    })
}

async function main(): Promise<void> {
    const args: Args = parseArgs(process.argv.slice(2))
    const appSupportPath: string = process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()

    // In headless mode the graph-db-server runs in-process (no vt-graphd
    // binary), so the binary's tracing init is bypassed. Wire it here so
    // ~/.voicetree/traces/vt-graphd.ndjson is populated for perf and
    // diagnostics runs against vt-mcpd.
    tracing.init('vt-graphd')

    configureHeadlessBridges(appSupportPath, args.vault)
    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    let daemonHandle: DaemonHandle
    try {
        daemonHandle = await startDaemon({
            vault: args.vault,
            appSupportPath,
        })
    } catch (err) {
        die(`failed to start graph-db-server: ${(err as Error).message}`)
    }

    if (daemonHandle.alreadyRunning) {
        die(
            `graph-db-server already running for ${args.vault} (pid ${daemonHandle.alreadyRunning.pid}). `
            + `Stop it before starting vt-mcpd in headless mode.`,
        )
    }

    let mcpHandle: McpServerHandle
    try {
        mcpHandle = await startMcpServer({startPort: args.port})
    } catch (err) {
        await daemonHandle.stop().catch(() => undefined)
        die(`failed to start MCP server: ${(err as Error).message}`)
    }

    const reconciliation = await agentRuntime.reconcileTmuxHeadlessAgents(args.vault)
    if (reconciliation.imported.length > 0 || reconciliation.markedExited.length > 0) {
        process.stderr.write(
            `vt-mcpd: reconciled tmux terminals imported=${reconciliation.imported.length} `
            + `markedExited=${reconciliation.markedExited.length}\n`,
        )
    }

    process.stdout.write(
        `vt-mcpd: graph-db on http://127.0.0.1:${daemonHandle.port}, `
        + `mcp on http://127.0.0.1:${mcpHandle.port}/mcp, vault=${args.vault}\n`,
    )

    let shuttingDown: boolean = false
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vt-mcpd: ${signal} received, shutting down\n`)
        // Order: MCP server → detach terminal runtime state → graph-db (watcher + lock).
        // tmux sessions survive host shutdown and are reconciled by the next host.
        try {
            await mcpHandle.stop().catch((err: unknown) => {
                process.stderr.write(`vt-mcpd: mcp stop error: ${(err as Error).message}\n`)
            })
            agentRuntime.getTerminalManager().cleanup({tmuxSessions: 'preserve'})
            await daemonHandle.stop()
            process.exit(0)
        } catch (err) {
            process.stderr.write(`vt-mcpd: shutdown error: ${(err as Error).message}\n`)
            process.exit(1)
        }
    }
    process.on('SIGINT', (): void => void shutdown('SIGINT'))
    process.on('SIGTERM', (): void => void shutdown('SIGTERM'))
}

void main().catch((err: unknown) => {
    process.stderr.write(`vt-mcpd: fatal: ${(err as Error).message}\n`)
    process.exit(1)
})
