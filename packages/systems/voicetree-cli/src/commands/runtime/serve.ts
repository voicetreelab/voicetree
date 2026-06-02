// `vt serve` — two-ensure wrapper.
//
// Foreground convenience command that brings up both per-project daemons —
// vt-graphd and vt-daemon — via the owner-aware ensure clients, then idles
// the process so the operator's terminal stays attached.
//
// Architectural invariants (post BF-346 / BF-371 / BF-373 / BF-377):
//   - Neither daemon is owned by this process; both are cross-process
//     resources spawned (or reused) via the BF-348 spawn-lock + single-flight
//     ensure protocol. `vt serve` is a transient peer of both.
//   - On SIGINT/SIGTERM `vt serve` exits with the default Node behaviour; it
//     deliberately does NOT tear down either daemon — other CLI peers and
//     the Electron Main may still be using them, and each daemon's own
//     watchdog handles eventual shutdown.
//   - If `ensureGraphDaemonForProject` succeeds and then the vt-daemon ensure
//     fails, the graph-db daemon WAS just spawned by this same `vt serve`
//     invocation and has no other peer — leaving it running would orphan a
//     daemon that nobody asked to outlive the failed launch. So on a
//     vt-daemon ensure failure we tear the graph-db daemon down via its
//     /shutdown endpoint, but ONLY when this invocation launched it. A
//     graph-db owner we merely reused belongs to other peers and is left
//     untouched.
//   - Ordering: graph-db ensure runs BEFORE vt-daemon ensure. `bin/vtd.ts`
//     internally also calls `ensureGraphDaemonForProject`; this ordering means
//     the graph-db owner record already exists by the time vt-daemon starts,
//     so VTD's ensure call hits the reuse branch immediately.
//
// vt-daemon ensure is routed through the HIGH-LEVEL
// `ensureNodeVtDaemonForProject(runtime, project, caller, options)` entry,
// which builds the per-process single-flight state and the Node-side deps
// (filesystem, module resolution, clock) internally from the small runtime
// literal built below. The low-level `ensureVtDaemonForProject(state, deps,
// …)` takes those as its first two positional args and must NOT be called
// from here.

import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {
    ensureGraphDaemonForProject,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    ensureNodeVtDaemonForProject,
    type NodeEnsureVtDaemonRuntime,
} from '@vt/vt-daemon-client/nodeEnsureVtDaemonForProject'
import type {EnsureVtDaemonResult, VtDaemonClient} from '@vt/vt-daemon-client'
import {error} from '../output'
import {readRequiredFlagValue} from './argv'
import {emitInvocationStart} from '../telemetry/recordCliInvocation'

// Node-side runtime for the high-level vt-daemon ensure entry. Every field is
// the real platform primitive; impurity (filesystem, clock, randomness) lives
// here at the edge so the ensure machinery stays a pure orchestration over
// injected effects.
const NODE_ENSURE_RUNTIME: NodeEnsureVtDaemonRuntime = {
    env: process.env,
    mkdir,
    newAttemptId: randomUUID,
    now: Date.now,
    readTextFileSync: readFileSync,
    resolvePath: resolve,
}

type ServeArgs = {
    readonly project: string
    readonly exclusive: boolean
}

const SERVE_USAGE: string =
    'Usage: vt serve --project <path> [--exclusive]\n'

const readRequiredValue = (argv: readonly string[], index: number, flag: string): string =>
    readRequiredFlagValue(argv, index, flag, SERVE_USAGE)

function parseServeArgs(argv: readonly string[]): ServeArgs {
    let project: string | undefined
    let exclusive: boolean = false

    for (let index: number = 0; index < argv.length; index += 1) {
        const arg: string = argv[index]

        if (arg === '--help' || arg === '-h') {
            process.stdout.write(SERVE_USAGE)
            process.exit(0)
        }

        if (arg === '--project') {
            project = readRequiredValue(argv, index, '--project')
            index += 1
            continue
        }

        if (arg.startsWith('--project=')) {
            project = arg.slice('--project='.length)
            if (!project) {
                error(`--project requires a value\n\n${SERVE_USAGE}`)
            }
            continue
        }

        if (arg === '--exclusive') {
            exclusive = true
            continue
        }

        error(`unknown argument: ${arg}`)
    }

    if (!project) {
        error(`missing required --project <path>\n\n${SERVE_USAGE}`)
    }

    return {project: resolve(project), exclusive}
}

function exclusiveConflictMessage(
    kind: 'graph-db' | 'vt-daemon',
    project: string,
    handle: {readonly pid: number; readonly port: number},
): string {
    return (
        `--exclusive: ${kind} owner already exists for ${project} `
        + `(pid ${handle.pid}, port ${handle.port}). Stop the existing owner first.`
    )
}

const verb = (result: {readonly launched: boolean}): string =>
    result.launched ? 'launched' : 'reused'

// Tear down a graph-db daemon that THIS invocation just launched, used when a
// subsequent vt-daemon ensure fails and the freshly-spawned graph-db would
// otherwise be orphaned. A reused owner (launched === false) belongs to other
// peers and is left untouched. Best-effort: a /shutdown that itself fails must
// not mask the original vt-daemon ensure error, so failures are swallowed.
async function teardownLaunchedGraphd(graphd: EnsureGraphDaemonResult): Promise<void> {
    if (!graphd.launched) return
    try {
        await graphd.client.shutdown()
    } catch {
        // The graph-db daemon may already be gone, or /shutdown may be
        // unreachable; either way the caller is about to exit non-zero with
        // the vt-daemon ensure failure as the surfaced error.
    }
}

export type EnsuredDaemons = {
    readonly graphd: EnsureGraphDaemonResult
    readonly vtd: EnsureVtDaemonResult<VtDaemonClient>
}

// Boots both per-project daemons (graph-db first, then vt-daemon) via the
// owner-aware ensure clients, applying the BF-346/371/373 ordering and the
// orphan-teardown invariant. Shared by `vt serve` and `vt webapp`. On a
// vt-daemon ensure failure — or an --exclusive refusal — a graph-db daemon THIS
// call just launched is torn down so it is not orphaned; a reused graph-db
// owner is left running for its other peers.
export async function ensureBothDaemons(
    project: string,
    opts: {readonly exclusive: boolean},
): Promise<EnsuredDaemons> {
    let graphd: EnsureGraphDaemonResult
    try {
        graphd = await ensureGraphDaemonForProject(project, 'cli', {
            bin: process.env.VT_GRAPHD_BIN,
        })
    } catch (cause) {
        error(`failed to ensure graph-db owner: ${(cause as Error).message}`)
    }

    if (opts.exclusive && !graphd.launched) {
        error(exclusiveConflictMessage('graph-db', project, graphd))
    }

    let vtd: EnsureVtDaemonResult<VtDaemonClient>
    try {
        vtd = await ensureNodeVtDaemonForProject(NODE_ENSURE_RUNTIME, project, 'cli', {
            bin: process.env.VT_DAEMON_BIN,
        })
    } catch (cause) {
        // The vt-daemon ensure failed. If THIS invocation launched the
        // graph-db daemon a moment ago, it now has no peer and tearing it
        // down here is the only way to avoid orphaning a daemon nobody asked
        // to outlive the failed launch. A reused graph-db owner belongs to
        // other peers and is left running.
        await teardownLaunchedGraphd(graphd)
        error(`failed to ensure vt-daemon owner: ${(cause as Error).message}`)
    }

    if (opts.exclusive && !vtd.launched) {
        // --exclusive refused: a vt-daemon owner already existed. That owner
        // belongs to other peers and is left running, but a graph-db daemon
        // THIS invocation launched a moment ago has no peer — tear it down so
        // the refusal does not leave it orphaned. (A reused graph-db owner is
        // left untouched by teardownLaunchedGraphd.)
        await teardownLaunchedGraphd(graphd)
        error(exclusiveConflictMessage('vt-daemon', project, vtd))
    }

    return {graphd, vtd}
}

export async function runServeCommand(argv: string[]): Promise<void> {
    const args: ServeArgs = parseServeArgs(argv)
    const {graphd, vtd}: EnsuredDaemons = await ensureBothDaemons(args.project, {
        exclusive: args.exclusive,
    })

    process.stdout.write(
        `vt serve: graph-db ${verb(graphd)} on http://127.0.0.1:${graphd.port} (pid ${graphd.pid}), `
        + `vt-daemon ${verb(vtd)} on ${vtd.client.baseUrl} (pid ${vtd.pid}), `
        + `project=${args.project}\n`,
    )

    // Emit phase="start" telemetry record. Long-running command — without
    // this, a crash before clean shutdown would leave no trace of the launch.
    emitInvocationStart()

    // Idle the foreground process. Both daemons live cross-process per
    // BF-346 and their respective Phase 1 ensure invariants, so `vt serve`
    // owns nothing of its own to tear down on signal.
    //
    // Implementation note: `await new Promise(() => {})` alone does NOT
    // keep Node's event loop alive — a pending top-level await with no
    // active handles triggers Node's "unsettled top-level await" exit
    // (code 13). A long idle timer keeps the loop alive; the signal
    // handlers below clear it and exit cleanly without touching either
    // daemon. Operators stop the daemons explicitly via their /shutdown
    // endpoint or by terminating the recorded owner pid.
    const idleHandle: NodeJS.Timeout = setInterval((): void => {}, 1_000_000)
    const onSignal = (): void => {
        clearInterval(idleHandle)
        process.exit(0)
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    await new Promise<void>(() => {})
}
