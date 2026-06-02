#!/usr/bin/env -S node --import tsx
// vtd: the standalone VoiceTree daemon (VTD). One process per project per
// machine. Owns the tool catalog, the agent runtime (tmux + lifecycle
// telemetry), and the unified HTTP transport (RPC + hook fan-in + event
// subscription) for a single project. Talks to vt-graphd over RPC via
// ensureGraphDaemonForProject — vt-graphd is a SIBLING process, not a child.
//
// Lifecycle:
//   1. swallow EPIPE on stdout/stderr (parent pipe can close at any time).
//   2. parse --project (required), --port (optional bind pin), --log-level.
//   3. tracing.init('vtd') so ~/.voicetree/traces/vtd.ndjson is populated.
//   4. claim the per-project VTD owner record under
//      <project>/.voicetree/vtd.owner.json (fails loudly on conflict — no
//      retry, no backoff; ensure-side coordination lives in BF-373).
//   5. ensureGraphDaemonForProject('vtd') — adopt or spawn a vt-graphd
//      sibling. This binary becomes a CLIENT of graphd; it does NOT
//      embed it. Per BF-346: vt-graphd is shared cross-process and must
//      outlive any single VTD.
//   6. configure the headless bridges + start tmux.
//   7. publish a fresh bearer auth-token (mode 0600) + the bound port
//      file under <project>/.voicetree/.
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
//                 the watched project; the chokidar mount inside vt-graphd
//                 reconciles them into the graph-store singleton.
// `create_graph` (and other write tools) validate `callerTerminalId`
// against getTerminalRecords(), which vtd intentionally seeds empty in
// headless mode — so a CLI agent invoking create_graph receives a clean
// "Unknown caller terminal: <id>" tool error rather than silent corruption.
//
// Open question (BF-373 / Phase 4): per-project-per-machine vs per-process
// multiplexing. This binary assumes one VTD per project and a required
// `--project` argument. If BF-373's design flips to a `POST /project/open`
// per-process surface, `--project` becomes optional. See
// docs/daemon-first-architecture.md.

import {unlink} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ensureGraphDaemonForProject, type EnsureGraphDaemonResult} from '@vt/graph-db-client'
import {startParentPidWatchdog, startParentWatch, type CallerKind} from '@vt/daemon-lifecycle'
import {tracing} from '@vt/observability'
import {resolveVoicetreeHomePath} from '@vt/paths'
import {loadSettings} from '@vt/app-config/settings'
import {
    startHttpDaemonServer,
    type HookHandler,
    type HttpDaemonServerHandle,
} from '@vt/vt-daemon/transport/httpServer.ts'
import type {McpToolBridges} from '@vt/vt-daemon/config/mcpBridges.ts'
import {setCurrentProject} from '@vt/vt-daemon/state/currentProject.ts'
import {buildDefaultToolCatalog} from '@vt/vt-daemon/transport/toolCatalog.ts'
import {createGatewayLiveUpdates} from '@vt/vt-daemon/transport/gatewayLiveUpdates.ts'
import {parseLocalhostCorsOrigins} from '@vt/vt-daemon/transport/browser/corsHeaders.ts'
import {handleHookEventRequest} from '@vt/vt-daemon/hooks/hookEventHandler.ts'
import {startOtlpReceiver, stopOtlpReceiver} from '@vt/vt-daemon/observability/otlpReceiver.ts'
import {terminalRuntimeSurface as agentRuntime} from '@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts'
import {ensureHomePrompts} from '@vt/vt-daemon/agent-runtime/spawn/ensureHomePrompts.ts'
import {reconcileTmuxHeadlessAgents} from '@vt/vt-daemon/agent-runtime/headless/headlessAgentManager.ts'
import {buildGraphGatewayRoutes} from '../src/rpc/graphGatewayRoutes.ts'
import {buildGdbGraphBridge} from '../src/config/gdbGraphBridge.ts'
import {buildGdbAgentRuntimeGraphBridge} from '../src/config/gdbAgentRuntimeBridge.ts'
import {
    buildPublishTerminalRegistryEvent,
    configureAgentRuntimeForVtd,
} from '../src/config/vtdAgentRuntimeWiring.ts'
import {TERMINAL_REGISTRY_TOPIC} from '@vt/vt-daemon-protocol'
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
    readonly project: string
    readonly port?: number
    readonly logLevel: 'info' | 'debug'
}

function die(msg: string): never {
    process.stderr.write(`vtd: ${msg}\n`)
    process.exit(1)
}

function parseArgs(argv: readonly string[]): Args {
    let project: string | null = null
    let port: number | undefined
    let logLevel: 'info' | 'debug' = 'info'
    for (let i: number = 0; i < argv.length; i++) {
        const a: string = argv[i]
        if (a === '--project') {
            project = argv[++i] ?? null
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
                'Usage: vtd --project <path> [--port <n>] [--log-level info|debug]\n',
            )
            process.exit(0)
        } else {
            die(`unknown argument: ${a}`)
        }
    }
    if (!project) die('missing required --project <path>')
    return {project: resolve(project!), port, logLevel}
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

/**
 * Resolve the canonical `@voicetree/cli` package dir relative to this binary on
 * disk: packages/systems/vt-daemon/bin → packages/systems/voicetree-cli. It is
 * the source of both the `vt` bin (spawn-time PATH injection) and the shipped
 * agent prompts (the home-prompts sync). This source-tree resolver is the
 * standalone/dev/eval path; the packaged Electron build instead seeds the home
 * prompts from `resourcesPath/prompts` via build-config.
 */
function resolveVoicetreeCliPackageDir(): string {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'voicetree-cli')
}

async function main(): Promise<void> {
    tracing.init('vtd')
    const args: Args = parseArgs(process.argv.slice(2))
    // Normalize VOICETREE_HOME_PATH so every leaf in this process and every
    // child it spawns reads the same resolved path via resolveVoicetreeHomePath().
    const voicetreeHomePath: string = resolveVoicetreeHomePath()
    process.env.VOICETREE_HOME_PATH = voicetreeHomePath

    // Step 1: claim the owner record FIRST, before any HTTP / GDB / tmux work.
    // On conflict (another VTD already owns this project) die loudly with the
    // contending pid + nonce — BF-371 §Gotcha #2: never wrap this in a retry
    // loop, that recreates the May-22 fork-storm.
    let ownerHandle: VtDaemonOwnerHandle
    try {
        ownerHandle = await claimVtDaemonOwner({
            canonicalProject: args.project,
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
            die(`owner conflict for project ${err.canonicalProject}: pid ${err.existingOwner.pid} (nonce ${err.existingOwner.ownerNonce})`)
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
    // Budget parity (startup-hang fix): electron waits up to 30s for THIS VTD to
    // report healthy, and VTD reports healthy only after this graphd-ensure
    // resolves. Graphd's 5s default here is a budget inversion — a slow-but-
    // healthy graphd would `die()` VTD at 5s while electron would have waited,
    // leaving the renderer spinning on "loading workspace". Match electron's 30s.
    const GRAPHD_ENSURE_TIMEOUT_MS = 30_000
    let gdb: EnsureGraphDaemonResult
    try {
        gdb = await ensureGraphDaemonForProject(args.project, 'vtd', {
            bin: process.env.VT_GRAPHD_BIN,
            timeoutMs: GRAPHD_ENSURE_TIMEOUT_MS,
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
    const mcpBridges: McpToolBridges = {graph: buildGdbGraphBridge(gdb.client, args.project)}

    // Step 3: bind in-process state to this project, then tmux preflight.
    // setCurrentProject is the single source-of-truth for daemon-internal
    // state singletons (sessionStateStore reads <project>/.voicetree/ via
    // getProject()). agent-runtime is configured later (step 4.5) once we
    // have the SSE hub the publish sink targets.
    setCurrentProject(args.project)

    // Provision the single per-machine prompts location BEFORE any agent can be
    // spawned — the spawn pipeline's buildTerminalEnvVars reads ~/.voicetree/prompts.
    // The shipped prompts always win; a user override is stashed under
    // ~/.voicetree/.backup/prompts/<ts>/. Standalone/headless daemons (which run no
    // Electron) depend on this call; the GUI app idempotently seeds the same dir at
    // Electron startup. Non-fatal: a sync failure degrades to empty prompts, not a
    // dead daemon (mirrors the OTLP/telemetry log-and-continue boot steps below).
    try {
        const promptSync = await ensureHomePrompts({
            promptsSource: join(resolveVoicetreeCliPackageDir(), 'prompts'),
            voicetreeHome: voicetreeHomePath,
            now: new Date(),
        })
        if (promptSync.backedUp.length > 0) {
            process.stderr.write(
                `vtd: stashed ${promptSync.backedUp.length} user-overridden prompt(s) under `
                + `${join(voicetreeHomePath, '.backup', 'prompts')}/<timestamp>: ${promptSync.backedUp.join(', ')}\n`,
            )
        }
    } catch (err) {
        process.stderr.write(`vtd: home prompts sync failed (continuing): ${(err as Error).message}\n`)
    }

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    // Step 4: auth + HTTP daemon. Publish a fresh per-startup bearer token
    // before any port file exists (so a reader cannot see the new port +
    // stale token simultaneously).
    const token: string = generateAuthToken()
    await writeAuthTokenFile(args.project, token)

    const hookHandler: HookHandler = (input): unknown =>
        handleHookEventRequest(
            {source: input.source, terminalId: input.terminalId, hookEventName: input.eventName},
            {updateAgentEvent: agentRuntime.updateTerminalAgentEvent},
        )

    const startMs: number = Date.now()
    let httpHandle: HttpDaemonServerHandle

    // Gateway live-update pump + graph.* routes (RE-PLAN B). VTD owns ONE graphd
    // session; the pump folds graphd's projectedGraph SSE onto the /events hub
    // `graph` topic so the browser gets live graph updates over the single
    // connection it already holds — it never reaches graphd. publishGraphSnapshot
    // reads httpHandle.hub lazily: the pump only starts on the first graph.* RPC,
    // long after the server (and its hub) is up — the same late-bound-hub pattern
    // as configureAgentRuntimeForVtd below.
    const gatewayLiveUpdates = createGatewayLiveUpdates({
        client: gdb.client,
        publishGraphSnapshot: (snapshot): void => httpHandle.hub.publish('graph', 'projectedGraph', snapshot),
        onError: (err): void => {
            process.stderr.write(`vtd: graph live-update pump error: ${(err as Error).message}\n`)
        },
    })
    const graphGatewayRoutes = buildGraphGatewayRoutes({
        client: gdb.client,
        ensureSession: gatewayLiveUpdates.ensureSession,
    })

    try {
        httpHandle = await startHttpDaemonServer({
            catalog: buildDefaultToolCatalog(mcpBridges, graphGatewayRoutes),
            hookHandler,
            token,
            // Default bind is loopback. VTD is a per-project per-machine daemon;
            // binding to all interfaces is a security regression. The override
            // env var is preserved for the rare LAN-development case where a
            // dev on another machine dials this daemon directly.
            bindHost: process.env.VOICETREE_DAEMON_BIND ?? '127.0.0.1',
            port: args.port,
            // Stamped into every `agent-events` SSE envelope so consumers
            // can apply the project-switch fence (BF-376 / main-host-purity
            // spec §"Project-switch fence drops stale events").
            canonicalProject: args.project,
            // Resolved per attach so a `terminalTmuxMouseMode` flip in project
            // settings takes effect on the next tmux connection without
            // restarting the daemon. The tmux-attach wiring forwards this
            // into `attachTmuxSessionToWebSocket`, which sets `tmux set mouse
            // on/off` after `configureTmuxSession`. Default false keeps
            // browser-style text selection working without holding Shift.
            getTmuxMouseMode: async (): Promise<boolean> => (await loadSettings()).terminalTmuxMouseMode ?? false,
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
                canonicalProject: args.project,
            }),
            // Browser-mode CORS: only localhost origins pass validation — anything
            // that is not http://localhost:<port> or http://127.0.0.1:<port> is
            // silently dropped. Set VOICETREE_CORS_ORIGINS to opt in, e.g.
            //   VOICETREE_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
            allowedOrigins: parseLocalhostCorsOrigins(process.env.VOICETREE_CORS_ORIGINS ?? ''),
            // No graphdUrl in the browser payload — under the gateway the browser
            // talks ONLY to VTD; graphd stays loopback-internal (VTD reaches it
            // via gdb.client, which already holds gdb.port).
            projectPath: args.project,
        })
        await writeRpcPortFile(args.project, httpHandle.port)
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
        resolveVoicetreeCliPackageDir(),
        buildPublishTerminalRegistryEvent(
            (event: string, data: unknown): void =>
                httpHandle.hub.publish(TERMINAL_REGISTRY_TOPIC, event, data),
        ),
        buildGdbAgentRuntimeGraphBridge(gdb.client, args.project),
    )

    // OTLP receiver — receives metrics from Claude-Code-style agents on
    // localhost:4318+. Publishes <project>/.voicetree/otlp.port so the agent
    // spawn pipeline can inject OTEL_EXPORTER_OTLP_ENDPOINT against the
    // actual bound port (which retries on EADDRINUSE up to +9). Failure is
    // non-fatal: the daemon stays up; agent metrics simply aren't collected.
    try {
        await startOtlpReceiver(args.project)
    } catch (err) {
        process.stderr.write(
            `vtd: OTLP receiver start failed (continuing): ${(err as Error).message}\n`,
        )
    }

    // Lifecycle JSONL telemetry sink — predecessor (the headless daemon binary) had this; vtd keeps it.
    try {
        agentRuntime.installJsonlTelemetrySink(join(voicetreeHomePath, 'lifecycle-telemetry.jsonl'))
    } catch (err) {
        process.stderr.write(
            `vtd: telemetry sink install skipped: ${(err as Error).message}\n`,
        )
    }

    const reconciliation = await reconcileTmuxHeadlessAgents(args.project)
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
        `vtd: listening on ${httpHandle.url}, project=${args.project}, gdb=${gdb.port}\n`,
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
        // window for this project will adopt the same graphd.
        // We delete <project>/.voicetree/rpc.port before release so a reader
        // never sees a missing owner record but a stale port — the absence of
        // the port file is the signal that the daemon is gone.
        try {
            stopHeartbeat()
            // Tear down the graph live-update SSE subscription before closing the
            // hub it publishes onto. graphd itself is NOT shut down (shared
            // cross-process sibling, BF-346) — we only drop our own subscription.
            gatewayLiveUpdates.stop()
            await stopOtlpReceiver().catch((err: unknown): void => {
                process.stderr.write(`vtd: OTLP receiver stop error: ${(err as Error).message}\n`)
            })
            await httpHandle.stop().catch((err: unknown): void => {
                process.stderr.write(`vtd: http daemon stop error: ${(err as Error).message}\n`)
            })
            agentRuntime.getTerminalManager().cleanup({tmuxSessions: 'preserve'})
            await unlink(rpcPortFilePath(args.project)).catch((err: NodeJS.ErrnoException): void => {
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
    // via ensureVtDaemonForProject (BF-373).
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
