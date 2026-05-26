#!/usr/bin/env -S node --import tsx
// vt-mcpd: headless VoiceTree daemon. Embeds graph-db-server + the lifted
// tool catalog in one Node process, with no Electron dependency. Lifecycle
// (Step 9b — unified HTTP transport):
//   1. Parse --vault (required) and --port (optional bind pin; default 0).
//   2. Wire @vt/agent-runtime + @vt/vt-daemon late-bound bridges for
//      headless mode.
//   3. Start graph-db-server in-process via startDaemon (loads graph,
//      mounts watcher, publishes graphd.port, owns the per-vault lock).
//   4. Start the unified HTTP daemon server (single http.createServer, four
//      routes — design doc §2.5). Atomic publish of rpc.port and a fresh
//      bearer auth-token (mode 0600) into <vault>/.voicetree/.
//   5. Install the lifecycle JSONL telemetry sink.
//   6. Wait for SIGINT/SIGTERM, then tear down:
//      HTTP daemon → terminals → graph-db.
//
// Headless contract (decided in Phase E; see docs/headless-migration.md):
//   - READ path:  CLI agents call any read tool over the HTTP wire. These do
//                 not require a terminal record on the daemon side.
//   - WRITE path: CLI agents write new nodes by raw filesystem Write into
//                 the watched vault; the chokidar mount inside startDaemon
//                 reconciles them into the graph-store singleton.
// `create_graph` (and other write tools) validate `callerTerminalId`
// against getTerminalRecords(), which vt-mcpd intentionally seeds empty in
// headless mode — so a CLI agent invoking create_graph receives a clean
// "Unknown caller terminal: <id>" tool error rather than silent corruption.
// Bootstrapping a synthetic terminal record was rejected: the registry
// models real PTY/agent processes with budget + lifecycle; a synthetic
// terminal has no real owner.

import {existsSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {tracing} from '@vt/observability'
import {
    buildDefaultToolCatalog,
    configureMcpServer,
    handleHookEventRequest,
    registerChildIfMonitored,
    startHttpDaemonServer,
    type HookHandler,
    type HttpDaemonServerHandle,
} from '@vt/vt-daemon'
import {agentRuntime, configureAgentRuntime} from '@vt/agent-runtime'
import {resolveVtBinDir} from '@vt/agent-runtime/spawn/injection/vtPathInjection.ts'
import {generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'

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

    // The CLI manual and `vt` binary are both shipped inside @voicetree/cli.
    // vt-mcpd lives next to it on disk (packages/systems/vt-daemon →
    // packages/systems/voicetree-cli), so resolve relative to this file
    // rather than the appSupport-tools copy.
    const voicetreeCliPackageDir: string = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'voicetree-cli',
    )
    const vtCliManualPath: string = join(voicetreeCliPackageDir, 'prompts', 'cli-manual.md')
    // `vt` lives at <voicetree-cli>/bin/vt. resolveVtBinDir verifies the
    // script exists and returns null otherwise — the spawn pipeline's
    // PATH injection then no-ops gracefully.
    const vtBinDir: string | null = resolveVtBinDir(voicetreeCliPackageDir, existsSync)

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => appSupportPath,
            getCliManualPath: (): string => vtCliManualPath,
            getVtBinDir: (): string | null => vtBinDir,
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

    configureHeadlessBridges(appSupportPath)
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

    const token: string = generateAuthToken()
    await writeAuthTokenFile(args.vault, token)

    const hookHandler: HookHandler = (input): unknown =>
        handleHookEventRequest(
            {source: input.source, terminalId: input.terminalId, hookEventName: input.eventName},
            {updateAgentEvent: agentRuntime.updateTerminalAgentEvent},
        )

    let httpHandle: HttpDaemonServerHandle
    try {
        httpHandle = await startHttpDaemonServer({
            catalog: buildDefaultToolCatalog(),
            hookHandler,
            token,
            bindHost: process.env.VOICETREE_DAEMON_BIND ?? '0.0.0.0',
            port: args.port,
        })
        await writeRpcPortFile(args.vault, httpHandle.port)
    } catch (err) {
        await daemonHandle.stop().catch(() => undefined)
        die(`failed to start HTTP daemon server: ${(err as Error).message}`)
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
        + `daemon on ${httpHandle.url}, vault=${args.vault}\n`,
    )

    let shuttingDown: boolean = false
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vt-mcpd: ${signal} received, shutting down\n`)
        // Order: HTTP daemon → detach terminal runtime → graph-db lock.
        // tmux sessions survive host shutdown and are reconciled by the next host.
        try {
            await httpHandle.stop().catch((err: unknown) => {
                process.stderr.write(`vt-mcpd: http daemon stop error: ${(err as Error).message}\n`)
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
