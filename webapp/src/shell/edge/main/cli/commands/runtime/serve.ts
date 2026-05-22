import {join, resolve} from 'node:path'
import {agentRuntime, configureAgentRuntime, getTerminalManager} from '@vt/agent-runtime'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {
    buildDefaultToolCatalog,
    configureMcpServer,
    generateAuthToken,
    handleHookEventRequest,
    registerChildIfMonitored,
    startHttpDaemonServer,
    startVaultStateWatcher,
    writeAuthTokenFile,
    type HookHandler,
    type HttpDaemonServerHandle,
    type VaultStateWatcherHandle,
} from '@vt/voicetree-mcp'
import {writeRpcPortFile} from '@vt/vt-rpc'
import {error} from '@/shell/edge/main/cli/output'
import {emitInvocationStart, setErrorClass} from '@/shell/edge/main/cli/telemetry/recordCliInvocation'
import {resolveAppSupportPath} from '@/shell/edge/main/cli/util/appSupportPath'

type ServeArgs = {
    readonly port?: number
    readonly vault: string
}

const SERVE_USAGE: string = 'Usage: vt serve --vault <path> [--port <n>]\n'

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

        error(`unknown argument: ${arg}`)
    }

    if (!vault) {
        error(`missing required --vault <path>\n\n${SERVE_USAGE}`)
    }

    return {port, vault: resolve(vault)}
}

function configureHeadlessBridges(appSupportPath: string): void {
    configureMcpServer({
        liveState: {
            applyLiveCommand: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_dispatch_live_command requires an Electron renderer. Not available in headless vt serve.',
                )),
            getLiveStateSnapshot: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_get_live_state requires an Electron renderer. Not available in headless vt serve.',
                )),
        },
    })

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => appSupportPath,
        },
        ui: {
            registerChildIfMonitored,
        },
    })
}

export async function runServeCommand(argv: string[]): Promise<void> {
    const args: ServeArgs = parseServeArgs(argv)
    const appSupportPath: string = resolveAppSupportPath()

    configureHeadlessBridges(appSupportPath)

    let daemonHandle: DaemonHandle
    try {
        daemonHandle = await startDaemon({
            vault: args.vault,
            appSupportPath,
        })
    } catch (cause) {
        error(`failed to start graph-db-server: ${(cause as Error).message}`)
    }

    if (daemonHandle.alreadyRunning) {
        error(
            `graph-db-server already running for ${args.vault} (pid ${daemonHandle.alreadyRunning.pid}). `
            + 'Stop it before starting vt serve in headless mode.',
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
        await daemonHandle.stop().catch(() => undefined)
        error(`failed to start HTTP daemon server: ${(cause as Error).message}`)
    }

    let vaultStateWatcher: VaultStateWatcherHandle
    try {
        vaultStateWatcher = startVaultStateWatcher({vaultPath: args.vault, hub: httpHandle.hub})
    } catch (cause) {
        await httpHandle.stop().catch(() => undefined)
        await daemonHandle.stop().catch(() => undefined)
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

    process.stdout.write(
        `vt serve: graph-db on http://127.0.0.1:${daemonHandle.port}, `
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
            getTerminalManager().cleanup()
            await daemonHandle.stop()
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
