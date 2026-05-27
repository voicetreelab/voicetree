// `vt serve` — two-ensure wrapper.
//
// Foreground convenience command that brings up both per-vault daemons —
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
//   - If `ensureGraphDaemonForVault` succeeds and then
//     `ensureVtDaemonForVault` fails, the graph-db daemon is left running
//     (BF-346: graph-db is a cross-process resource available to peers).
//     This is intentional behaviour but differs from the pre-BF-377
//     in-process boot that tore everything down on any failure.
//   - Ordering: graph-db ensure runs BEFORE vt-daemon ensure. `bin/vtd.ts`
//     internally also calls `ensureGraphDaemonForVault`; this ordering means
//     the graph-db owner record already exists by the time vt-daemon starts,
//     so VTD's ensure call hits the reuse branch immediately.

import {resolve} from 'node:path'
import {
    ensureGraphDaemonForVault,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    ensureVtDaemonForVault,
    type EnsureVtDaemonResult,
} from '@vt/vt-daemon-client'
import {error} from '../output'
import {emitInvocationStart} from '../telemetry/recordCliInvocation'

type ServeArgs = {
    readonly vault: string
    readonly exclusive: boolean
}

const SERVE_USAGE: string =
    'Usage: vt serve --vault <path> [--exclusive]\n'

function readRequiredValue(argv: readonly string[], index: number, flag: string): string {
    const value: string | undefined = argv[index + 1]
    if (!value || value.startsWith('--')) {
        error(`${flag} requires a value\n\n${SERVE_USAGE}`)
    }

    return value
}

function parseServeArgs(argv: readonly string[]): ServeArgs {
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

        if (arg === '--exclusive') {
            exclusive = true
            continue
        }

        error(`unknown argument: ${arg}`)
    }

    if (!vault) {
        error(`missing required --vault <path>\n\n${SERVE_USAGE}`)
    }

    return {vault: resolve(vault), exclusive}
}

function exclusiveConflictMessage(
    kind: 'graph-db' | 'vt-daemon',
    vault: string,
    handle: {readonly pid: number; readonly port: number},
): string {
    return (
        `--exclusive: ${kind} owner already exists for ${vault} `
        + `(pid ${handle.pid}, port ${handle.port}). Stop the existing owner first.`
    )
}

const verb = (result: {readonly launched: boolean}): string =>
    result.launched ? 'launched' : 'reused'

export async function runServeCommand(argv: string[]): Promise<void> {
    const args: ServeArgs = parseServeArgs(argv)

    let graphd: EnsureGraphDaemonResult
    try {
        graphd = await ensureGraphDaemonForVault(args.vault, 'cli', {
            bin: process.env.VT_GRAPHD_BIN,
        })
    } catch (cause) {
        error(`failed to ensure graph-db owner: ${(cause as Error).message}`)
    }

    if (args.exclusive && !graphd.launched) {
        error(exclusiveConflictMessage('graph-db', args.vault, graphd))
    }

    let vtd: EnsureVtDaemonResult
    try {
        vtd = await ensureVtDaemonForVault(args.vault, 'cli', {
            bin: process.env.VT_DAEMON_BIN,
        })
    } catch (cause) {
        // Per BF-346: graph-db remains a cross-process resource; we do NOT
        // tear it down on a vt-daemon ensure failure. Operators stop daemons
        // explicitly via /shutdown or by terminating the recorded owner pid.
        error(`failed to ensure vt-daemon owner: ${(cause as Error).message}`)
    }

    if (args.exclusive && !vtd.launched) {
        error(exclusiveConflictMessage('vt-daemon', args.vault, vtd))
    }

    process.stdout.write(
        `vt serve: graph-db ${verb(graphd)} on http://127.0.0.1:${graphd.port} (pid ${graphd.pid}), `
        + `vt-daemon ${verb(vtd)} on ${vtd.client.baseUrl} (pid ${vtd.pid}), `
        + `vault=${args.vault}\n`,
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
