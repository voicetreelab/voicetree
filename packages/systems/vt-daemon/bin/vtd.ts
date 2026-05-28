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
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ensureGraphDaemonForVault, type EnsureGraphDaemonResult} from '@vt/graph-db-client'
import {startParentPidWatchdog, startParentWatch, type CallerKind} from '@vt/daemon-lifecycle'
import {tracing} from '@vt/observability'
import {resolveAppSupportPath} from '@vt/app-config/app-support-path'
import {
    startHttpDaemonServer,
    type HookHandler,
    type HttpDaemonServerHandle,
} from '@vt/vt-daemon/transport/httpServer.ts'
import type {McpToolBridges} from '@vt/vt-daemon/config/mcpBridges.ts'
import {setCurrentVault} from '@vt/vt-daemon/state/currentVault.ts'
import {buildDefaultToolCatalog} from '@vt/vt-daemon/transport/toolCatalog.ts'
import {handleHookEventRequest} from '@vt/vt-daemon/hooks/hookEventHandler.ts'
import {registerChildIfMonitored} from '@vt/vt-daemon/agent-runtime/agent-control/agent-completion-monitor.ts'
import {startOtlpReceiver, stopOtlpReceiver} from '@vt/vt-daemon/observability/otlpReceiver.ts'
import {terminalRuntimeSurface as agentRuntime} from '@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {resolveVtBinDir} from '@vt/vt-daemon/agent-runtime/spawn/vtPathInjection.ts'
import {reconcileTmuxHeadlessAgents} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentManager.ts'
import {buildGdbGraphBridge} from '../src/config/gdbGraphBridge.ts'
import {buildGdbAgentRuntimeGraphBridge} from '../src/config/gdbAgentRuntimeBridge.ts'
import type {GraphStateBridge} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {
    TERMINAL_REGISTRY_TOPIC,
    type TerminalRegistryEvent,
} from '@vt/vt-daemon-protocol'
import {generateAuthToken, rpcPortFilePath, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'
import {VTD_CONTRACT_VERSION, type VtDaemonHealthResponse} from '../src/contract.ts'
import {buildVtDaemonHealthResponse} from '../src/lifecycle/buildHealthResponse.ts'
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

function configureAgentRuntimeForVtd(
    publishTerminalRegistryEvent: (event: TerminalRegistryEvent) => void,
    graph: GraphStateBridge,
): void {
    // The `vt` binary is shipped inside @voicetree/cli. vtd lives next to
    // it on disk (packages/systems/vt-daemon → packages/systems/voicetree-cli),
    // so resolve relative to this file rather than the appSupport-tools copy.
    // The CLI manual is rendered live from @vt/vt-daemon-protocol's TOOL_SPECS
    // — no longer file-based — so vtd no longer needs to register a manual path.
    const voicetreeCliPackageDir: string = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'voicetree-cli',
    )
    // `vt` lives at <voicetree-cli>/bin/vt. resolveVtBinDir verifies the
    // script exists and returns null otherwise — the spawn pipeline's
    // PATH injection then no-ops gracefully.
    const vtBinDir: string | null = resolveVtBinDir(voicetreeCliPackageDir, existsSync)

    configureAgentRuntime({
        env: {
            getVtBinDir: (): string | null => vtBinDir,
        },
        publishTerminalRegistryEvent,
        graph,
    })
}

/**
 * Build the publish sink injected into agent-runtime. Two concerns fan out
 * from a single event:
 *
 *   1. Wire publish onto the new `terminal-registry` SSE topic so renderer
 *      clients learn about registry mutations and the imperative UI-launch
 *      instructions that used to fire as in-process UI callbacks.
 *   2. In-process side effect for `terminal-ui-child-registered`: VTD owns
 *      the agent-completion monitor (`@vt/vt-daemon`'s
 *      `registerChildIfMonitored`); when a spawn announces a new child of a
 *      monitored parent, the monitor's terminal-id table must learn about
 *      it before the child's first poll. Pre-S2-R this happened through an
 *      in-process callback; that callback is gone, so we route the same
 *      data through the publish sink instead.
 *
 * The sink is the canonical place to do both because it sits at the boundary
 * where every event passes through exactly once.
 */
function buildPublishTerminalRegistryEvent(
    publishOnTopic: (event: string, data: unknown) => void,
): (event: TerminalRegistryEvent) => void {
    return (event: TerminalRegistryEvent): void => {
        publishOnTopic(event.type, event)
        if (event.type === 'terminal-ui-child-registered') {
            registerChildIfMonitored(event.parentTerminalId, event.childTerminalId)
        }
    }
}

async function main(): Promise<void> {
    tracing.init('vtd')
    const args: Args = parseArgs(process.argv.slice(2))
    // Normalize VOICETREE_APP_SUPPORT so every leaf in this process and every
    // child it spawns reads the same resolved path via resolveAppSupportPath().
    const appSupportPath: string = resolveAppSupportPath()
    process.env.VOICETREE_APP_SUPPORT = appSupportPath

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

    // Step 2.5: construct the MCP tool bridges to the sibling vt-graphd over
    // RPC. Every graph-touching tool in the catalog (`spawn_agent`,
    // `list_agents`, `get_unseen_nodes_nearby`, `create_graph`, live state)
    // resolves through these bridges. They are passed explicitly into
    // `buildDefaultToolCatalog` below — no module-level cell — so the wiring
    // contract is enforced by the type system. The BF-376 regression
    // (missing wire-up) is now a compile-time error rather than a runtime
    // "MCP graph bridge not configured" throw.
    const mcpBridges: McpToolBridges = {graph: buildGdbGraphBridge(gdb.client, args.vault)}

    // Step 3: bind in-process state to this vault, then tmux preflight.
    // setCurrentVault is the single source-of-truth for daemon-internal
    // state singletons (sessionStateStore reads <vault>/.voicetree/ via
    // getVault()). agent-runtime is configured later (step 4.5) once we
    // have the SSE hub the publish sink targets.
    setCurrentVault(args.vault)
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

    const startMs: number = Date.now()
    let httpHandle: HttpDaemonServerHandle
    try {
        httpHandle = await startHttpDaemonServer({
            catalog: buildDefaultToolCatalog(mcpBridges),
            hookHandler,
            token,
            // Default bind is loopback. VTD is a per-vault per-machine daemon;
            // binding to all interfaces is a security regression. The override
            // env var is preserved for the rare LAN-development case where a
            // dev on another machine dials this daemon directly.
            bindHost: process.env.VOICETREE_DAEMON_BIND ?? '127.0.0.1',
            port: args.port,
            // Stamped into every `agent-events` SSE envelope so consumers
            // can apply the vault-switch fence (BF-376 / main-host-purity
            // spec §"Vault-switch fence drops stale events").
            canonicalVault: args.vault,
            // Live owner-projection — must call ownerHandle.health() on EACH
            // request, never cache. Returns null in the window between
            // claimVtDaemonOwner and bindPort; the BF-373 ensure path treats
            // owner-null as "mismatch / retry", which is exactly what we want
            // during cold-start. Caching a pre-bindPort snapshot would freeze
            // owner=null forever and break BF-374's storm-reuse decision.
            readHealth: (): VtDaemonHealthResponse => buildVtDaemonHealthResponse({
                contractVersion: VTD_CONTRACT_VERSION,
                startMs,
                nowMs: Date.now(),
                owner: ownerHandle.health(),
                canonicalVault: args.vault,
            }),
        })
        await writeRpcPortFile(args.vault, httpHandle.port)
        await ownerHandle.bindPort(httpHandle.port)
    } catch (err) {
        await ownerHandle.release().catch(() => undefined)
        die(`failed to start HTTP daemon server: ${(err as Error).message}`)
    }

    const stopHeartbeat: () => void = ownerHandle.startHeartbeat()

    // Step 4.5: now that the SSE hub is ready, configure agent-runtime with
    // the publish sink that routes terminal-registry events onto the new
    // topic + the in-process completion-monitor side channel.
    //
    // The agent-runtime graph bridge is wired here too: `spawnTerminalWithContextNode`
    // and friends read graph state through the agent-runtime module-level cell, which
    // is a SEPARATE slot from `mcpBridges.graph` despite the contracts overlapping.
    // Both must be wired or the spawn pipeline throws "graph bridge not configured"
    // on the first Run-Agent click.
    configureAgentRuntimeForVtd(
        buildPublishTerminalRegistryEvent(
            (event: string, data: unknown): void =>
                httpHandle.hub.publish(TERMINAL_REGISTRY_TOPIC, event, data),
        ),
        buildGdbAgentRuntimeGraphBridge(gdb.client, args.vault),
    )

    // OTLP receiver — receives metrics from Claude-Code-style agents on
    // localhost:4318+. Publishes <vault>/.voicetree/otlp.port so the agent
    // spawn pipeline can inject OTEL_EXPORTER_OTLP_ENDPOINT against the
    // actual bound port (which retries on EADDRINUSE up to +9). Failure is
    // non-fatal: the daemon stays up; agent metrics simply aren't collected.
    try {
        await startOtlpReceiver(args.vault)
    } catch (err) {
        process.stderr.write(
            `vtd: OTLP receiver start failed (continuing): ${(err as Error).message}\n`,
        )
    }

    // Lifecycle JSONL telemetry sink — predecessor (vt-mcpd) had this; vtd keeps it.
    try {
        agentRuntime.installJsonlTelemetrySink(join(appSupportPath, 'lifecycle-telemetry.jsonl'))
    } catch (err) {
        process.stderr.write(
            `vtd: telemetry sink install skipped: ${(err as Error).message}\n`,
        )
    }

    const reconciliation = await reconcileTmuxHeadlessAgents(args.vault)
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
            await stopOtlpReceiver().catch((err: unknown): void => {
                process.stderr.write(`vtd: OTLP receiver stop error: ${(err as Error).message}\n`)
            })
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
