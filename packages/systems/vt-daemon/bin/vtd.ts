#!/usr/bin/env -S node --import tsx
// vtd: the standalone VoiceTree daemon (VTD). One process per vault per
// machine. Owns the tool catalog, the agent runtime (tmux + lifecycle
// telemetry), and the unified HTTP transport (RPC + hook fan-in + event
// subscription) for a single vault. Talks to vt-graphd over RPC via
// ensureGraphDaemonForVault — vt-graphd is a SIBLING process, not a child.
//
// Lifecycle:
//   1. swallow EPIPE on stdout/stderr (parent pipe can close at any time).
//   2. parse --vault (required), --port (optional bind pin), --log-level.
//   3. tracing.init('vtd') so ~/.voicetree/traces/vtd.ndjson is populated.
//   4. claim the per-vault VTD owner record under
//      <vault>/.voicetree/vtd.owner.json (fails loudly on conflict — no
//      retry, no backoff; ensure-side coordination lives in BF-373).
//   5. ensureGraphDaemonForVault('vtd') — adopt or spawn a vt-graphd
//      sibling. This binary becomes a CLIENT of graphd; it does NOT
//      embed it. Per BF-346: vt-graphd is shared cross-process and must
//      outlive any single VTD.
//   6. configure the headless bridges + start tmux.
//   7. publish a fresh bearer auth-token (mode 0600) + the bound port
//      file under <vault>/.voicetree/.
//   8. start the unified HTTP daemon, bind owner-handle's port, start
//      the heartbeat ticker.
//   9. install lifecycle JSONL telemetry sink + tmux reconciliation.
//  10. emit the readiness line; wait for SIGINT/SIGTERM.
//
// Shutdown order (do NOT reorder):
//   stopHeartbeat → http.stop → terminalManager.cleanup({tmuxSessions:
//   'preserve'}) → ownerHandle.release. Critically, we do NOT stop
//   vt-graphd: it is a shared cross-process daemon (BF-346 invariant).
//
// Headless contract (decided in Phase E; see docs/headless-migration.md):
//   - READ path:  CLI agents call any read tool over the HTTP wire. These
//                 do not require a terminal record on the daemon side.
//   - WRITE path: CLI agents write new nodes by raw filesystem Write into
//                 the watched vault; the chokidar mount inside vt-graphd
//                 reconciles them into the graph-store singleton.
// `create_graph` (and other write tools) validate `callerTerminalId`
// against getTerminalRecords(), which vtd intentionally seeds empty in
// headless mode — so a CLI agent invoking create_graph receives a clean
// "Unknown caller terminal: <id>" tool error rather than silent corruption.
//
// Open question (BF-373 / Phase 4): per-vault-per-machine vs per-process
// multiplexing. This binary assumes one VTD per vault and a required
// `--vault` argument. If BF-373's design flips to a `POST /vault/open`
// per-process surface, `--vault` becomes optional. See
// docs/daemon-first-architecture.md.

import {existsSync} from 'node:fs'
import {unlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ensureGraphDaemonForVault, type EnsureGraphDaemonResult} from '@vt/graph-db-client'
import {startParentPidWatchdog, startParentWatch, type CallerKind} from '@vt/daemon-lifecycle'
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
import {generateAuthToken, rpcPortFilePath, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'
import {VTD_CONTRACT_VERSION} from '../src/contract.ts'
import {
    claimVtDaemonOwner,
    VtDaemonOwnerConflictError,
    type VtDaemonOwnerHandle,
} from '../src/lifecycle/vtDaemonOwnerLifecycle.ts'

// The daemon may be spawned detached with stderr piped to its parent. When the
// parent exits, writes to that pipe error with EPIPE. Without this listener,
// an EPIPE during shutdown's stderr write would surface as an uncaughtException
// and Node would exit before release() finished — leaving the owner + port
// files behind for the next launcher to find.
const swallowEpipe = (stream: NodeJS.WriteStream): void => {
    stream.on('error', (err: NodeJS.ErrnoException): void => {
        if (err.code !== 'EPIPE') throw err
    })
}
swallowEpipe(process.stdout)
swallowEpipe(process.stderr)

interface Args {
    readonly vault: string
    readonly port?: number
    readonly logLevel: 'info' | 'debug'
}

function die(msg: string): never {
    process.stderr.write(`vtd: ${msg}\n`)
    process.exit(1)
}

function parseArgs(argv: readonly string[]): Args {
    let vault: string | null = null
    let port: number | undefined
    let logLevel: 'info' | 'debug' = 'info'
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
        } else if (a === '--log-level') {
            const v: string | undefined = argv[++i]
            if (v === 'info' || v === 'debug') logLevel = v
            else die(`invalid --log-level: ${v}`)
        } else if (a === '--help' || a === '-h') {
            process.stdout.write(
                'Usage: vtd --vault <path> [--port <n>] [--log-level info|debug]\n',
            )
            process.exit(0)
        } else {
            die(`unknown argument: ${a}`)
        }
    }
    if (!vault) die('missing required --vault <path>')
    return {vault: resolve(vault!), port, logLevel}
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

// Caller-kind resolution. `VT_DAEMON_CALLER_KIND` is set by
// @vt/daemon-lifecycle's spawnDaemon when a parent (Electron / CLI) spawned
// us; absent that we self-identify as 'vtd' — this binary's intrinsic
// identity. Returns the env override only when it is a known CallerKind;
// an unknown value falls back to 'vtd' rather than crashing the binary at
// claim time (we'd prefer a self-identified daemon over a fatal exit).
const CALLER_KINDS: readonly CallerKind[] = [
    'electron',
    'electron-main',
    'cli',
    'mcp',
    'graph-db-client',
    'test',
    'vtd',
] as const

function isCallerKind(value: string): value is CallerKind {
    return (CALLER_KINDS as readonly string[]).includes(value)
}

function callerKindFromEnv(): CallerKind {
    const raw: string | undefined = process.env.VT_DAEMON_CALLER_KIND
    if (raw && isCallerKind(raw)) return raw
    return 'vtd'
}

function configureHeadlessBridges(appSupportPath: string): void {
    // Live-state tools require an Electron renderer back-channel. The
    // standalone VTD binary does not have one yet — Phase 4 (BF-378) will
    // design a back-channel so the spawning Electron Main can subscribe.
    // Until then, fail with a specific MCP error rather than crashing the
    // daemon, and be explicit that the rejection is provisional, not a
    // permanent architectural truth.
    configureMcpServer({
        liveState: {
            applyLiveCommand: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_dispatch_live_command requires a live-state back-channel. Not yet implemented for standalone vtd (see openspec vtd-live-state-bridge).',
                )),
            getLiveStateSnapshot: (): Promise<never> =>
                Promise.reject(new Error(
                    'vt_get_live_state requires a live-state back-channel. Not yet implemented for standalone vtd (see openspec vtd-live-state-bridge).',
                )),
        },
        // search bridge omitted: search_nodes returns "Search backend is not configured."
    })

    // The CLI manual and `vt` binary are both shipped inside @voicetree/cli.
    // vtd lives next to it on disk (packages/systems/vt-daemon →
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
    tracing.init('vtd')
    const args: Args = parseArgs(process.argv.slice(2))
    const appSupportPath: string = process.env.VOICETREE_APP_SUPPORT ?? defaultAppSupportPath()

    // Step 1: claim the owner record FIRST, before any HTTP / GDB / tmux work.
    // On conflict (another VTD already owns this vault) die loudly with the
    // contending pid + nonce — BF-371 §Gotcha #2: never wrap this in a retry
    // loop, that recreates the May-22 fork-storm.
    let ownerHandle: VtDaemonOwnerHandle
    try {
        ownerHandle = await claimVtDaemonOwner({
            canonicalVault: args.vault,
            callerKind: callerKindFromEnv(),
            contractVersion: VTD_CONTRACT_VERSION,
            commandFingerprint: {
                executable: process.execPath,
                args: process.argv.slice(1),
            },
            clock: Date.now,
        })
    } catch (err) {
        if (err instanceof VtDaemonOwnerConflictError) {
            die(`owner conflict for vault ${err.canonicalVault}: pid ${err.existingOwner.pid} (nonce ${err.existingOwner.ownerNonce})`)
        }
        die(`failed to claim VTD owner: ${(err as Error).message}`)
    }

    // Step 2: adopt-or-spawn vt-graphd as a SIBLING process. VTD becomes a
    // client of graphd, not its parent. Per BF-346 invariant, vt-graphd is
    // shared cross-process and outlives this VTD — never shut it down here.
    //
    // `VT_GRAPHD_BIN` is honored as an override (used by tests pointing at a
    // fake vt-graphd; also useful in dev to point at a freshly built binary).
    // Mirrors `ensureDaemon` in @vt/graph-db-client.
    let gdb: EnsureGraphDaemonResult
    try {
        gdb = await ensureGraphDaemonForVault(args.vault, 'vtd', {
            bin: process.env.VT_GRAPHD_BIN,
        })
    } catch (err) {
        await ownerHandle.release().catch(() => undefined)
        die(`failed to ensure vt-graphd sibling: ${(err as Error).message}`)
    }

    // Step 3: bridges + tmux. configureMcpServer wires the headless live-state
    // rejectors; configureAgentRuntime wires manual-path + vt-bin-dir for the
    // spawn pipeline. tmux must be available because every interactive agent
    // session lives in a tmux session.
    configureHeadlessBridges(appSupportPath)
    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    // Step 4: auth + HTTP daemon. Publish a fresh per-startup bearer token
    // before any port file exists (so a reader cannot see the new port +
    // stale token simultaneously).
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
            // Default bind is loopback. VTD is a per-vault per-machine daemon;
            // binding to all interfaces is a security regression. The override
            // env var is preserved for the rare LAN-development case where a
            // dev on another machine dials this daemon directly.
            bindHost: process.env.VOICETREE_DAEMON_BIND ?? '127.0.0.1',
            port: args.port,
        })
        await writeRpcPortFile(args.vault, httpHandle.port)
        await ownerHandle.bindPort(httpHandle.port)
    } catch (err) {
        await ownerHandle.release().catch(() => undefined)
        die(`failed to start HTTP daemon server: ${(err as Error).message}`)
    }

    const stopHeartbeat: () => void = ownerHandle.startHeartbeat()

    // Lifecycle JSONL telemetry sink — predecessor (vt-mcpd) had this; vtd keeps it.
    try {
        agentRuntime.installJsonlTelemetrySink(join(appSupportPath, 'lifecycle-telemetry.jsonl'))
    } catch (err) {
        process.stderr.write(
            `vtd: telemetry sink install skipped: ${(err as Error).message}\n`,
        )
    }

    const reconciliation = await agentRuntime.reconcileTmuxHeadlessAgents(args.vault)
    if (reconciliation.imported.length > 0 || reconciliation.markedExited.length > 0) {
        process.stderr.write(
            `vtd: reconciled tmux terminals imported=${reconciliation.imported.length} `
            + `markedExited=${reconciliation.markedExited.length}\n`,
        )
    }

    // Readiness line — the format is a contract. Parsed by ensure-callers
    // (BF-373) and by storm-regression harnesses (BF-374). Do not reformat
    // without updating both consumers.
    process.stdout.write(
        `vtd: listening on ${httpHandle.url}, vault=${args.vault}, gdb=${gdb.port}\n`,
    )

    let shuttingDown: boolean = false
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        process.stderr.write(`vtd: ${signal} received, shutting down\n`)
        // Shutdown order (load-bearing — do NOT reorder):
        //   stopHeartbeat → http.stop → terminalManager.cleanup(preserve)
        //   → rpc.port cleanup → ownerHandle.release.
        // We deliberately do NOT touch vt-graphd: it is shared cross-process
        // and must outlive this VTD (BF-346 invariant). The next CLI / Electron
        // window for this vault will adopt the same graphd.
        // We delete <vault>/.voicetree/rpc.port before release so a reader
        // never sees a missing owner record but a stale port — the absence of
        // the port file is the signal that the daemon is gone.
        try {
            stopHeartbeat()
            await httpHandle.stop().catch((err: unknown): void => {
                process.stderr.write(`vtd: http daemon stop error: ${(err as Error).message}\n`)
            })
            agentRuntime.getTerminalManager().cleanup({tmuxSessions: 'preserve'})
            await unlink(rpcPortFilePath(args.vault)).catch((err: NodeJS.ErrnoException): void => {
                if (err.code !== 'ENOENT') {
                    process.stderr.write(`vtd: rpc.port cleanup error: ${err.message}\n`)
                }
            })
            await ownerHandle.release()
            process.exit(0)
        } catch (err) {
            process.stderr.write(`vtd: shutdown error: ${(err as Error).message}\n`)
            process.exit(1)
        }
    }
    process.on('SIGINT', (): void => void shutdown('SIGINT'))
    process.on('SIGTERM', (): void => void shutdown('SIGTERM'))

    // Parent-pid watchdog (BF-369). When the parent dies, take ourselves
    // down — this is best-effort cleanup, not a coordination protocol. Any
    // remaining caller (a second Electron window, a CLI) will respawn VTD
    // via ensureVtDaemonForVault (BF-373).
    const parentPidEnv: string | undefined = process.env.VOICETREE_PARENT_PID
    if (parentPidEnv) {
        const parentPid: number = Number.parseInt(parentPidEnv, 10)
        if (Number.isInteger(parentPid) && parentPid > 0) {
            startParentPidWatchdog({
                onParentGone: (): void => void shutdown('PARENT_GONE'),
                parentPid,
            })
        } else {
            process.stderr.write(`vtd: ignoring invalid VOICETREE_PARENT_PID=${parentPidEnv}\n`)
        }
    }

    // Optional defensive reparent watch (BF-369). Defends against the case
    // where VOICETREE_PARENT_PID was set but the kernel reaped our parent
    // and reparented us to launchd before the watchdog's poll caught it.
    // Gated by env var to mirror graphd's opt-in shape (see
    // graph-db-server/src/daemon/daemonTypes.ts:VT_DAEMON_EXIT_ON_PARENT_DEATH).
    if (process.env.VT_DAEMON_EXIT_ON_PARENT_DEATH === '1') {
        startParentWatch({
            onOrphaned: (): void => void shutdown('REPARENTED'),
        })
    }
}

void main().catch((err: unknown) => {
    process.stderr.write(`vtd: fatal: ${(err as Error).message}\n`)
    process.exit(1)
})
