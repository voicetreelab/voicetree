import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {agentRuntime, configureAgentRuntime, getTerminalManager} from '@vt/agent-runtime'
import {
    ensureGraphDaemonForVault,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    configureMcpServer,
    getMcpPort,
    registerChildIfMonitored,
    startMcpServer,
    type McpServerHandle,
} from '@vt/voicetree-mcp'
import {error} from '@/shell/edge/main/cli/output'

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

function parsePort(rawPort: string): number {
    const port: number = Number.parseInt(rawPort, 10)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        error(`invalid --port: ${rawPort}`)
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
            port = parsePort(readRequiredValue(argv, index, '--port'))
            index += 1
            continue
        }

        if (arg.startsWith('--port=')) {
            port = parsePort(arg.slice('--port='.length))
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
            getMcpPort,
        },
        ui: {
            registerChildIfMonitored,
        },
    })
}

export async function runServeCommand(argv: string[]): Promise<void> {
    const args: ServeArgs = parseServeArgs(argv)
    const appSupportPath: string = process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()
    // Propagate the resolved app-support path to the vt-graphd child the
    // owner-aware ensure spawns. The child's own resolver also falls back to
    // VOICETREE_APP_SUPPORT, so this keeps the CLI and the spawned daemon
    // pointed at the same Voicetree state directory even when the user did
    // not set the env var themselves.
    process.env.VOICETREE_APP_SUPPORT = appSupportPath

    configureHeadlessBridges(appSupportPath)
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

    let mcpHandle: McpServerHandle
    try {
        mcpHandle = await startMcpServer({startPort: args.port})
    } catch (cause) {
        error(`failed to start MCP server: ${(cause as Error).message}`)
    }

    // `args.vault` is treated as projectRoot here. Headless callers
    // (vt serve / vt-mcpd) MUST pass projectRoot — the directory that
    // contains `.voicetree/` — not a vault sub-directory used as writeFolder.
    // See openspec/changes/fix-resume-recovery-and-surviving-agents-ux.
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
        + `mcp on http://127.0.0.1:${mcpHandle.port}/mcp, vault=${args.vault}\n`,
    )

    let shuttingDown: boolean = false
    const shutdown: (signal: string) => Promise<void> = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vt serve: ${signal} received, shutting down\n`)

        try {
            await mcpHandle.stop().catch((cause: unknown) => {
                process.stderr.write(`vt serve: mcp stop error: ${(cause as Error).message}\n`)
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
            process.exit(1)
        }
    }

    process.on('SIGINT', (): void => void shutdown('SIGINT'))
    process.on('SIGTERM', (): void => void shutdown('SIGTERM'))
}
