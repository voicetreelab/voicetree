#!/usr/bin/env -S node --import tsx
// vt-mcpd: headless VoiceTree daemon. Embeds graph-db-server + the lifted
// tool catalog in one Node process, with no Electron dependency. Lifecycle:
//   1. Parse --vault (required) and --hook-port (optional pin for the hook HTTP
//      server; default ephemeral).
//   2. Wire @vt/agent-runtime + @vt/voicetree-mcp late-bound bridges for headless mode.
//   3. Start graph-db-server in-process via startDaemon (loads graph, mounts watcher,
//      publishes graphd.port, owns the per-vault lock).
//   4. Start the UDS JSON-RPC server (per-vault socket file; design doc §2.3).
//   5. Start the dedicated hook HTTP server and publish <vault>/.voicetree/hook.port.
//   6. Install the lifecycle JSONL telemetry sink.
//   7. Wait for SIGINT/SIGTERM, then tear down: hook → UDS → terminals → graph-db.
//
// Headless contract (decided in Phase E; see docs/headless-migration.md):
//   - READ path:  CLI agents call any read tool over the UDS wire (graph_structure,
//                 get_unseen_nodes_nearby, …). These do not require a terminal
//                 record on the daemon side.
//   - WRITE path: CLI agents write new nodes by raw filesystem Write into the
//                 watched vault; the chokidar mount inside startDaemon
//                 reconciles them into the graph-store singleton.
// `create_graph` (and other write tools) validate `callerTerminalId` against
// getTerminalRecords(), which vt-mcpd intentionally seeds empty in headless
// mode — so a CLI agent invoking create_graph receives a clean
// "Unknown caller terminal: <id>" tool error rather than silent corruption.
// Bootstrapping a synthetic terminal record was rejected: the registry models
// real PTY/agent processes with budget + lifecycle; a synthetic terminal has
// no real owner. Phase D (phase-d-headless-e2e-result.md) verified the
// Write→watcher path end-to-end.

import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {
    buildDefaultToolCatalog,
    configureMcpServer,
    registerChildIfMonitored,
    resolveVaultSocketPath,
    startHookHttpServer,
    startUdsServer,
    writeHookPortFile,
    type HookHttpServerHandle,
    type UdsServerHandle,
} from '@vt/voicetree-mcp'
import {agentRuntime, configureAgentRuntime} from '@vt/agent-runtime'

interface Args {
    readonly vault: string
    readonly hookPort?: number
}

function die(msg: string): never {
    process.stderr.write(`vt-mcpd: ${msg}\n`)
    process.exit(1)
}

function parseArgs(argv: readonly string[]): Args {
    let vault: string | null = null
    let hookPort: number | undefined
    for (let i: number = 0; i < argv.length; i++) {
        const a: string = argv[i]
        if (a === '--vault') {
            vault = argv[++i] ?? null
        } else if (a === '--hook-port') {
            const v: string | undefined = argv[++i]
            const n: number = Number.parseInt(v ?? '', 10)
            if (!Number.isInteger(n) || n < 0 || n > 65535) {
                die(`invalid --hook-port: ${v}`)
            }
            hookPort = n
        } else if (a === '--help' || a === '-h') {
            process.stdout.write('Usage: vt-mcpd --vault <path> [--hook-port <n>]\n')
            process.exit(0)
        } else {
            die(`unknown argument: ${a}`)
        }
    }
    if (!vault) die('missing required --vault <path>')
    return {vault: resolve(vault!), hookPort}
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

function configureHeadlessBridges(appSupportPath: string): void {
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
            getCliManualPath: (): string => join(appSupportPath, 'tools', 'prompts', 'cli-manual.md'),
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

    configureHeadlessBridges(appSupportPath)

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

    let udsHandle: UdsServerHandle
    try {
        udsHandle = await startUdsServer({
            socketPath: resolveVaultSocketPath(args.vault),
            catalog: buildDefaultToolCatalog(),
        })
    } catch (err) {
        await daemonHandle.stop().catch(() => undefined)
        die(`failed to start UDS server: ${(err as Error).message}`)
    }

    let hookHandle: HookHttpServerHandle
    try {
        hookHandle = await startHookHttpServer({
            port: args.hookPort,
            updateAgentEvent: agentRuntime.updateTerminalAgentEvent,
        })
        await writeHookPortFile(args.vault, hookHandle.port)
    } catch (err) {
        await udsHandle.stop().catch(() => undefined)
        await daemonHandle.stop().catch(() => undefined)
        die(`failed to start hook HTTP server: ${(err as Error).message}`)
    }

    // Lifecycle JSONL telemetry sink.
    try {
        agentRuntime.installJsonlTelemetrySink(join(appSupportPath, 'lifecycle-telemetry.jsonl'))
    } catch (err) {
        process.stderr.write(
            `vt-mcpd: telemetry sink install skipped: ${(err as Error).message}\n`,
        )
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
        + `uds on ${udsHandle.socketPath}, hook on http://127.0.0.1:${hookHandle.port}, `
        + `vault=${args.vault}\n`,
    )

    let shuttingDown: boolean = false
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vt-mcpd: ${signal} received, shutting down\n`)
        // Order: hook → UDS server → terminals/PTYs (incl. headless agents) → graph-db (watcher + lock)
        try {
            await hookHandle.stop().catch((err: unknown) => {
                process.stderr.write(`vt-mcpd: hook stop error: ${(err as Error).message}\n`)
            })
            await udsHandle.stop().catch((err: unknown) => {
                process.stderr.write(`vt-mcpd: uds stop error: ${(err as Error).message}\n`)
            })
            agentRuntime.getTerminalManager().cleanup()
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
