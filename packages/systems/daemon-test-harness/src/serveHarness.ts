// Shared black-box harness for booting real `vt serve` daemons (graphd + vtd)
// from tsx source bins. Two consumers import this package:
//   1. voicetree-cli's `serveOwner.e2e.test.ts` (vitest) — the two-ensure
//      wrapper contract spec.
//   2. webapp's Playwright `daemon_integration/globalSetup.ts` — boots one
//      `vt serve` so the browser round-trip e2e talks to live daemons.
//
// Everything here is an edge effect (child-process spawn, HTTP, filesystem,
// signals) over real platform primitives — there are no internal mocks and no
// test-framework coupling (no `expect`), so the module is importable from any
// runtime (vitest, Playwright, plain node). The vitest spec composes these
// against the real `vt serve` CLI and the real per-project daemons.
//
// vt-daemon prewarm goes through the HIGH-LEVEL
// `ensureNodeVtDaemonForProject(runtime, project, caller, options)` entry — the
// same entry `vt serve` itself uses. The low-level
// `ensureVtDaemonForProject(state, deps, …)` takes the single-flight state +
// deps as its first two positional args and is NOT a `(project, caller,
// options)` call.

import {spawn, type ChildProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    ensureGraphDaemonForProject,
    GraphDbClient,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    ensureNodeVtDaemonForProject,
    type NodeEnsureVtDaemonRuntime,
} from '@vt/vt-daemon-client/nodeEnsureVtDaemonForProject'
import type {
    EnsureVtDaemonOptions,
    EnsureVtDaemonResult,
    VtDaemonClient,
} from '@vt/vt-daemon-client'
import type {CallerKind} from '@vt/daemon-lifecycle'
import {readAuthTokenFile} from '@vt/vt-rpc'
import {
    HealthResponseSchema,
    ownerRecordFile,
    VtDaemonHealthResponseSchema,
    type HealthResponse,
    type OwnerRecord,
    type VtDaemonHealthResponse,
} from '@vt/graph-db-protocol'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))

// Walk up to the monorepo root (the dir that holds pnpm-workspace.yaml) instead
// of hardcoding a fixed-depth `..`-chain. A literal `../../..` is fragile to
// package moves and is banned by the relative-path-depth health check; this
// mirrors the findUp idiom in agent-runtime/bin/vt-resume.ts and is also
// worktree-safe (every git worktree checks out pnpm-workspace.yaml at its root).
function findRepoRoot(start: string): string {
    let dir: string = resolve(start)
    while (true) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
        const parent: string = dirname(dir)
        if (parent === dir) {
            throw new Error(`repo root (pnpm-workspace.yaml) not found above ${start}`)
        }
        dir = parent
    }
}
export const REPO_ROOT: string = findRepoRoot(TEST_FILE_DIR)

// The CLI under test lives in the voicetree-cli package — resolve its entry +
// tsconfig from REPO_ROOT, NOT relative to this harness file. (This harness used
// to live inside voicetree-cli and derived these from its own location; once it
// moved into a shared package that derivation would have pointed at the wrong
// package, so anchor on REPO_ROOT like the daemon source bins below.)
const VOICETREE_CLI_DIR: string = join(REPO_ROOT, 'packages/systems/voicetree-cli')
const CLI_ENTRYPOINT: string = join(VOICETREE_CLI_DIR, 'src/voicetree-cli.ts')
const CLI_TSCONFIG: string = join(VOICETREE_CLI_DIR, 'tsconfig.json')
// Resolve the tsx CLI through Node's own module lookup. The worktree layout
// keeps the bulk of dependencies in the main repo's node_modules and only
// symlinks a tiny .bin subset under per-package node_modules, so a hardcoded
// node_modules/.bin/tsx path is unreliable here.
const HARNESS_REQUIRE = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(HARNESS_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const NODE_BIN: string = process.execPath
const GRAPHD_SOURCE_BIN: string = join(REPO_ROOT, 'packages/systems/graph-db-server/bin/vt-graphd.ts')
const VTD_SOURCE_BIN: string = join(REPO_ROOT, 'packages/systems/vt-daemon/bin/vtd.ts')
// `node <tsx-cli> <script>` is the worktree-portable equivalent of running
// `tsx <script>` directly — see TSX_CLI_PATH derivation above. Used for both
// graphd and vtd; the per-daemon ensure clients split on whitespace and
// append `--project-root <project>` / `--project <project>` respectively.
export const VT_GRAPHD_BIN_OVERRIDE: string = `${NODE_BIN} ${TSX_CLI_PATH} ${GRAPHD_SOURCE_BIN}`
export const VT_DAEMON_BIN_OVERRIDE: string = `${NODE_BIN} ${TSX_CLI_PATH} ${VTD_SOURCE_BIN}`
// A vt-daemon bin override that spawns, exits non-zero immediately, and never
// writes an owner record. With a short ensure timeout this drives the
// vt-daemon ensure to DaemonLaunchTimeout — the deterministic "induced
// vt-daemon failure" used to prove `vt serve` tears down the graph-db daemon
// it had just launched. The script must contain no whitespace because the
// command resolver splits the override on whitespace.
export const VT_DAEMON_BIN_FAILING: string = `${NODE_BIN} -e process.exit(7)`

export const SERVE_READY_TIMEOUT_MS: number = 20_000
export const SERVE_EXIT_TIMEOUT_MS: number = 10_000
export const DAEMON_SHUTDOWN_TIMEOUT_MS: number = 5_000
export const SCENARIO_TIMEOUT_MS: number = 60_000
export const ENSURE_TIMEOUT_MS: number = 20_000

export type ServeReady = {
    readonly graphdVerb: 'launched' | 'reused'
    readonly graphdPort: number
    readonly graphdPid: number
    readonly vtdVerb: 'launched' | 'reused'
    readonly vtdUrl: string
    readonly vtdPid: number
}

export type ServeHandle = {
    readonly child: ChildProcess
    readonly stdoutBuffer: {value: string}
    readonly stderrBuffer: {value: string}
    readonly ready: Promise<ServeReady>
    readonly exited: Promise<{code: number | null; signal: NodeJS.Signals | null}>
}

export function sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms))
}

// Read the daemon's per-startup bearer token from <project>/.voicetree/auth-token
// (vtd writes it mode-0600 with a trailing newline at boot). Reuses the canonical
// reader from @vt/vt-rpc (which trims the newline) and turns its "missing → null"
// into a hard failure: the browser harness has no fallback, so an absent token is
// a boot bug we want surfaced loudly, never a silent empty bearer.
export async function readAuthToken(project: string): Promise<string> {
    const token: string | null = await readAuthTokenFile(project)
    if (token === null) {
        throw new Error(`auth-token missing or empty for project ${project} (.voicetree/auth-token)`)
    }
    return token
}

// Node-side runtime for the high-level vt-daemon ensure entry, used by the
// prewarm helper below. Mirrors the runtime `vt serve` builds at its edge:
// real filesystem, clock, randomness.
const NODE_ENSURE_RUNTIME: NodeEnsureVtDaemonRuntime = {
    env: process.env,
    mkdir,
    newAttemptId: randomUUID,
    now: Date.now,
    readTextFileSync: readFileSync,
    resolvePath: resolve,
}

// Prewarm a vt-daemon owner via the same high-level entry `vt serve` uses, so
// the spec's reuse / exclusive setups converge on the identical ensure path as
// the subject under test.
export function prewarmVtd(
    project: string,
    caller: CallerKind,
    options: EnsureVtDaemonOptions,
): Promise<EnsureVtDaemonResult<VtDaemonClient>> {
    return ensureNodeVtDaemonForProject(NODE_ENSURE_RUNTIME, project, caller, options)
}

export function prewarmGraphd(
    project: string,
    caller: CallerKind,
    options: {readonly bin: string; readonly timeoutMs: number},
): Promise<EnsureGraphDaemonResult> {
    return ensureGraphDaemonForProject(project, caller, options)
}

function buildChildEnv(
    voicetreeHome: string,
    vtDaemonBin: string,
    extraEnv: Record<string, string>,
): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VOICETREE_HOME_PATH: voicetreeHome,
        TSX_TSCONFIG_PATH: CLI_TSCONFIG,
        VT_GRAPHD_BIN: VT_GRAPHD_BIN_OVERRIDE,
        VT_DAEMON_BIN: vtDaemonBin,
        ...extraEnv,
    }
    delete merged.VT_SESSION
    delete merged.VOICETREE_TERMINAL_ID
    // Strip any inherited VOICETREE_PARENT_PID. The harness boots an INDEPENDENT
    // `vt serve`; its graphd/vtd must be parented to that serve process (which we
    // keep alive for the test), never to whatever ambient process launched the
    // test runner. spawnDaemon PROPAGATES an inherited VOICETREE_PARENT_PID
    // verbatim, so without this the daemons' parent-pid watchdog points at a
    // foreign pid — and when the runner is itself spawned by a VoiceTree agent
    // terminal, that inherited pid is a long-dead app instance, so graphd boots,
    // immediately sees PARENT_GONE, and self-exits before the health probe can
    // verify it (surfacing as a misleading DaemonLaunchTimeout). Dropping it here
    // lets serve stamp its own (alive) pid as the parent.
    delete merged.VOICETREE_PARENT_PID
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) {
            result[key] = value
        }
    }
    return result
}

function parseServeReady(line: string): ServeReady | null {
    // Format produced by serve.ts:
    //   "vt serve: graph-db <verb> on http://127.0.0.1:<port> (pid <pid>),
    //    vt-daemon <verb> on <url> (pid <pid>), project=<path>"
    const match: RegExpExecArray | null = /^vt serve: graph-db (launched|reused) on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\), vt-daemon (launched|reused) on (\S+) \(pid (\d+)\), project=/m.exec(line)
    if (!match) return null
    const graphdVerb: 'launched' | 'reused' = match[1] === 'launched' ? 'launched' : 'reused'
    const vtdVerb: 'launched' | 'reused' = match[4] === 'launched' ? 'launched' : 'reused'
    return {
        graphdVerb,
        graphdPort: Number(match[2]),
        graphdPid: Number(match[3]),
        vtdVerb,
        vtdUrl: match[5],
        vtdPid: Number(match[6]),
    }
}

// Spawn the real `vt serve` CLI as a child process. `vtDaemonBin` defaults to
// the working VTD source bin; pass `VT_DAEMON_BIN_FAILING` to induce a
// vt-daemon ensure failure. `extraEnv` is merged last into the child env — the
// browser globalSetup uses it to set VOICETREE_CORS_ORIGINS so the spawned vtd
// allows the fixed web-server origin.
export function spawnServe(
    args: string[],
    voicetreeHome: string,
    vtDaemonBin: string = VT_DAEMON_BIN_OVERRIDE,
    extraEnv: Record<string, string> = {},
): ServeHandle {
    const child: ChildProcess = spawn(
        NODE_BIN,
        [TSX_CLI_PATH, CLI_ENTRYPOINT, 'serve', ...args],
        {
            cwd: REPO_ROOT,
            env: buildChildEnv(voicetreeHome, vtDaemonBin, extraEnv),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )
    const stdoutBuffer = {value: ''}
    const stderrBuffer = {value: ''}

    let readyResolve: (value: ServeReady) => void = () => {}
    let readyReject: (reason: Error) => void = () => {}
    const ready: Promise<ServeReady> = new Promise<ServeReady>((res, rej) => {
        readyResolve = res
        readyReject = rej
    })

    let exitedResolve: (value: {code: number | null; signal: NodeJS.Signals | null}) => void = () => {}
    const exited: Promise<{code: number | null; signal: NodeJS.Signals | null}> = new Promise((res) => {
        exitedResolve = res
    })

    let readyResolved: boolean = false
    const readyTimer: NodeJS.Timeout = setTimeout(() => {
        if (readyResolved) return
        readyReject(new Error(
            `vt serve did not become ready within ${SERVE_READY_TIMEOUT_MS}ms.\n`
            + `stdout:\n${stdoutBuffer.value}\nstderr:\n${stderrBuffer.value}`,
        ))
    }, SERVE_READY_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer): void => {
        stdoutBuffer.value += chunk.toString('utf8')
        if (!readyResolved) {
            const parsed: ServeReady | null = parseServeReady(stdoutBuffer.value)
            if (parsed !== null) {
                readyResolved = true
                clearTimeout(readyTimer)
                readyResolve(parsed)
            }
        }
    })
    child.stderr?.on('data', (chunk: Buffer): void => {
        stderrBuffer.value += chunk.toString('utf8')
    })

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null): void => {
        clearTimeout(readyTimer)
        if (!readyResolved) {
            readyReject(new Error(
                `vt serve exited before ready (code=${code} signal=${signal})\n`
                + `stdout:\n${stdoutBuffer.value}\nstderr:\n${stderrBuffer.value}`,
            ))
        }
        exitedResolve({code, signal})
    })

    return {child, stdoutBuffer, stderrBuffer, ready, exited}
}

export async function stopServe(handle: ServeHandle): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
        handle.child.kill('SIGTERM')
    }
    const killTimer: NodeJS.Timeout = setTimeout(() => {
        if (handle.child.exitCode === null && handle.child.signalCode === null) {
            handle.child.kill('SIGKILL')
        }
    }, SERVE_EXIT_TIMEOUT_MS)
    try {
        return await handle.exited
    } finally {
        clearTimeout(killTimer)
    }
}

export async function readOwnerRecord(project: string, daemonKind: 'graphd' | 'vtd'): Promise<OwnerRecord | null> {
    try {
        const raw: string = await readFile(ownerRecordFile.pathFor(project, daemonKind), 'utf8')
        return ownerRecordFile.decode(raw)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

export async function fetchGraphdHealth(port: number): Promise<HealthResponse> {
    const response: Response = await fetch(`http://127.0.0.1:${port}/health`)
    if (!response.ok) throw new Error(`unexpected graphd /health status ${response.status}`)
    const body: unknown = await response.json()
    const parsed = HealthResponseSchema.safeParse(body)
    if (!parsed.success) throw new Error(`graphd /health body did not parse: ${JSON.stringify(body)}`)
    return parsed.data
}

export async function fetchVtdHealth(url: string): Promise<VtDaemonHealthResponse> {
    const response: Response = await fetch(`${url}/health`)
    if (!response.ok) throw new Error(`unexpected vtd /health status ${response.status}`)
    const body: unknown = await response.json()
    const parsed = VtDaemonHealthResponseSchema.safeParse(body)
    if (!parsed.success) throw new Error(`vtd /health body did not parse: ${JSON.stringify(body)}`)
    return parsed.data
}

// True if a graph-db daemon is still answering /health on `port`. Used to
// prove a daemon was (not) torn down, without leaning on pid liveness alone.
export async function graphdHealthReachable(port: number): Promise<boolean> {
    try {
        const response: Response = await fetch(`http://127.0.0.1:${port}/health`)
        return response.ok
    } catch {
        return false
    }
}

export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
}

export async function shutdownGraphd(port: number): Promise<void> {
    const client: GraphDbClient = new GraphDbClient({baseUrl: `http://127.0.0.1:${port}`})
    await client.shutdown().catch(() => undefined)
}

export async function waitForDaemonExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (!isPidAlive(pid)) return true
        await sleep(50)
    }
    return false
}

export async function ensureCleanProject(project: string): Promise<void> {
    const graphdRecord: OwnerRecord | null = await readOwnerRecord(project, 'graphd')
    if (graphdRecord !== null && graphdRecord.port !== null) {
        await shutdownGraphd(graphdRecord.port)
        if (graphdRecord.pid) {
            await waitForDaemonExit(graphdRecord.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
        }
    }
    const vtdRecord: OwnerRecord | null = await readOwnerRecord(project, 'vtd')
    if (vtdRecord !== null && vtdRecord.pid) {
        // vtd has no GraphDbClient analogue; signal-terminate the pid.
        try {
            process.kill(vtdRecord.pid, 'SIGTERM')
        } catch {
            // already gone
        }
        await waitForDaemonExit(vtdRecord.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
    }
    for (const file of [
        'graphd.owner.json',
        'graphd.lock',
        'graphd.port',
        'vtd.owner.json',
        'vtd.spawn.lock',
        'vtd.cooldown.json',
        'auth-token',
        'rpc.port',
    ]) {
        await rm(join(project, '.voicetree', file), {force: true}).catch(() => undefined)
    }
}

export async function waitForExclusiveRefusal(
    handle: ServeHandle,
): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
    return Promise.race([
        handle.exited,
        handle.ready.then(
            (): never => {
                throw new Error(
                    `--exclusive unexpectedly became ready:\n${handle.stdoutBuffer.value}`,
                )
            },
            (): never => {
                throw new Error(
                    `--exclusive ready promise rejected:\n${handle.stderrBuffer.value}`,
                )
            },
        ),
    ]).catch(async (err: Error) => {
        if (err.message.startsWith('--exclusive ready promise rejected')) {
            // Ready promise rejects when child exits before ready — exactly
            // the path --exclusive takes against a pre-existing owner.
            return await handle.exited
        }
        throw err
    })
}

// Wait for `vt serve` to exit because its vt-daemon ensure failed. Mirrors
// waitForExclusiveRefusal: the ready promise rejects when the child exits
// before printing the ready line, which is exactly the induced-failure path.
export async function waitForVtdFailureExit(
    handle: ServeHandle,
): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
    return Promise.race([
        handle.exited,
        handle.ready.then(
            (): never => {
                throw new Error(
                    `vt serve unexpectedly became ready despite induced vt-daemon failure:\n${handle.stdoutBuffer.value}`,
                )
            },
            (): never => {
                throw new Error(
                    `vt serve ready promise rejected:\n${handle.stderrBuffer.value}`,
                )
            },
        ),
    ]).catch(async (err: Error) => {
        if (err.message.startsWith('vt serve ready promise rejected')) {
            return await handle.exited
        }
        throw err
    })
}
