import {existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {agentRuntime, configureAgentRuntime, getTerminalManager} from '@vt/agent-runtime'
import {resolveVtBinDir} from '@vt/agent-runtime/spawn/injection/vtPathInjection.ts'
import {
    ensureGraphDaemonForVault,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    buildDefaultToolCatalog,
    handleHookEventRequest,
    registerChildIfMonitored,
    setCurrentVault,
    startHttpDaemonServer,
    startVaultStateWatcher,
    type HookHandler,
    type HttpDaemonServerHandle,
    type VaultStateWatcherHandle,
} from '@vt/vt-daemon'
import {generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'
import {error} from '../output'
import {emitInvocationStart, setErrorClass} from '../telemetry/recordCliInvocation'
import {resolveAppSupportPath} from '../util/appSupportPath'

type ServeArgs = {
    readonly port?: number
    readonly vault: string
    readonly exclusive: boolean
}

const SERVE_USAGE: string =
    'Usage: vt serve --vault <path> [--port <n>] [--exclusive]\n'

function readRequiredValue(argv: readonly string[], index: number, flag: string): string {
    const value: string | undefined = argv[index + 1]
    if (!value || value.startsWith('--')) {
        error(`${flag} requires a value\n\n${SERVE_USAGE}`)
    }

    return value
}

function parsePort(rawPort: string, flag: string): number {
    const port: number = Number.parseInt(rawPort, 10)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        error(`invalid ${flag}: ${rawPort}`)
    }

    return port
}

function parseServeArgs(argv: readonly string[]): ServeArgs {
    let port: number | undefined
    let vault: string | undefined
    let exclusive: boolean = false

    for (let index: number = 0; index < argv.length; index += 1) {
        const arg: string = argv[index]

        if (arg === '--help' || arg === '-h') {
            process.stdout.write(SERVE_USAGE)
            process.exit(0)
        }

        if (arg === '--vault') {
            vault = readRequiredValue(argv, index, '--vault')
            index += 1
            continue
        }

        if (arg.startsWith('--vault=')) {
            vault = arg.slice('--vault='.length)
            if (!vault) {
                error(`--vault requires a value\n\n${SERVE_USAGE}`)
            }
            continue
        }

        if (arg === '--port') {
            port = parsePort(readRequiredValue(argv, index, '--port'), '--port')
            index += 1
            continue
        }

        if (arg.startsWith('--port=')) {
            port = parsePort(arg.slice('--port='.length), '--port')
            continue
        }

        if (arg === '--exclusive') {
            exclusive = true
            continue
        }

        error(`unknown argument: ${arg}`)
    }

    if (!vault) {
        error(`missing required --vault <path>\n\n${SERVE_USAGE}`)
    }

    return {port, vault: resolve(vault), exclusive}
}

// Walk up from `startUrl` until we hit the directory that contains `bin/vt`.
// Mirrors `findManualPath` in src/commands/manual.ts so the same source-vs-
// bundled-layout cases are handled consistently. Returns the absolute path
// to the @voicetree/cli package root, or null if no ancestor matches.
function findVoicetreeCliPackageDir(startUrl: string): string | null {
    let current: string = dirname(fileURLToPath(startUrl))
    while (current !== dirname(current)) {
        if (existsSync(join(current, 'bin', 'vt'))) return current
        current = dirname(current)
    }
    return null
}

function configureHeadlessBridges(appSupportPath: string): void {
    // `vt serve` is itself shipped inside @voicetree/cli, so the `vt` binary
    // lives in this very package's bin/ directory. Walk up from this module
    // until we find the directory containing `bin/vt`. This handles both the
    // source layout (<package>/src/commands/runtime/serve.ts) and the bundled
    // layout (<package>/dist/voicetree-cli.js) used by published installs.
    // Returns null on any unexpected layout — the spawn pipeline's PATH
    // injection then no-ops gracefully.
    const voicetreeCliPackageDir: string | null = findVoicetreeCliPackageDir(import.meta.url)
    const vtBinDir: string | null = resolveVtBinDir(voicetreeCliPackageDir, existsSync)

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => appSupportPath,
            getVtBinDir: (): string | null => vtBinDir,
        },
        ui: {
            registerChildIfMonitored,
        },
    })
}

export async function runServeCommand(argv: string[]): Promise<void> {
    const args: ServeArgs = parseServeArgs(argv)
    const appSupportPath: string = resolveAppSupportPath()
    // Propagate the resolved app-support path to the vt-graphd child the
    // owner-aware ensure spawns. The child's own resolver also falls back to
    // VOICETREE_APP_SUPPORT, so this keeps the CLI and the spawned daemon
    // pointed at the same Voicetree state directory even when the user did
    // not set the env var themselves.
    process.env.VOICETREE_APP_SUPPORT = appSupportPath

    configureHeadlessBridges(appSupportPath)
    setCurrentVault(args.vault)
    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    let owner: EnsureGraphDaemonResult
    try {
        owner = await ensureGraphDaemonForVault(args.vault, 'cli', {
            bin: process.env.VT_GRAPHD_BIN,
        })
    } catch (cause) {
        error(`failed to ensure graph-db owner: ${(cause as Error).message}`)
    }

    if (args.exclusive && !owner.launched) {
        // --exclusive refuses to share the vault. The existing owner is left
        // running untouched per the daemon-ownership spec: exclusive mode
        // never kills or replaces another owner implicitly.
        error(
            `--exclusive: vt-graphd owner already exists for ${args.vault} `
            + `(pid ${owner.pid}, port ${owner.port}). Stop the existing owner first.`,
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
    } catch (cause) {
        // BF-346: the graph-db owner is shared across processes — vt serve never
        // kills the daemon on its own exit. Only tear down what this process owns
        // (the HTTP daemon listener already started above is the only thing).
        error(`failed to start HTTP daemon server: ${(cause as Error).message}`)
    }

    let vaultStateWatcher: VaultStateWatcherHandle
    try {
        vaultStateWatcher = startVaultStateWatcher({vaultPath: args.vault, hub: httpHandle.hub})
    } catch (cause) {
        await httpHandle.stop().catch(() => undefined)
        error(`failed to start vault-state watcher: ${(cause as Error).message}`)
    }

    // Lifecycle JSONL telemetry sink.
    try {
        agentRuntime.installJsonlTelemetrySink(join(appSupportPath, 'lifecycle-telemetry.jsonl'))
    } catch (cause) {
        process.stderr.write(
            `vt serve: telemetry sink install skipped: ${(cause as Error).message}\n`,
        )
    }

    const reconciliation = await agentRuntime.reconcileTmuxHeadlessAgents(args.vault)
    if (reconciliation.imported.length > 0 || reconciliation.markedExited.length > 0) {
        process.stderr.write(
            `vt serve: reconciled tmux terminals imported=${reconciliation.imported.length} `
            + `markedExited=${reconciliation.markedExited.length}\n`,
        )
    }

    const ownerVerb: string = owner.launched ? 'launched' : 'reused'
    process.stdout.write(
        `vt serve: graph-db ${ownerVerb} on http://127.0.0.1:${owner.port} (pid ${owner.pid}), `
        + `daemon on ${httpHandle.url}, vault=${args.vault}\n`,
    )

    // Emit phase="start" telemetry record. Long-running command — without
    // this, a crash before clean shutdown would leave no trace of the launch.
    emitInvocationStart()

    let shuttingDown: boolean = false
    const shutdown: (signal: string) => Promise<void> = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vt serve: ${signal} received, shutting down\n`)

        try {
            await vaultStateWatcher.stop().catch((cause: unknown) => {
                process.stderr.write(`vt serve: vault-state watcher stop error: ${(cause as Error).message}\n`)
            })
            await httpHandle.stop().catch((cause: unknown) => {
                process.stderr.write(`vt serve: http daemon stop error: ${(cause as Error).message}\n`)
            })
            getTerminalManager().cleanup({tmuxSessions: 'preserve'})
            // The vt-graphd owner is a separately-owned, cross-process resource
            // (BF-346). Other callers — Electron, sibling CLI processes — may
            // still be using it, so vt serve never kills the daemon on its own
            // exit. Operators stop the daemon explicitly via its /shutdown
            // endpoint or by terminating the recorded owner pid.
            process.exit(0)
        } catch (cause) {
            process.stderr.write(`vt serve: shutdown error: ${(cause as Error).message}\n`)
            setErrorClass(cause instanceof Error ? cause.name : 'ServeShutdownError')
            process.exit(1)
        }
    }

    process.on('SIGINT', (): void => void shutdown('SIGINT'))
    process.on('SIGTERM', (): void => void shutdown('SIGTERM'))
}
