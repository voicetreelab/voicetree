// BF-377 — `vt serve` two-ensure wrapper.
//
// Black-box: spawn the real `vt serve` CLI as a child process and assert
// observable outcomes — stdout ready line, /health owner identity for both
// daemons, on-disk graphd.owner.json + vtd.owner.json contents, exit code,
// stderr fragments, cross-process lifetime of the spawned daemons. No
// internal mocks.
//
// Six scenarios cover the two-ensure wrapper contract:
//   1. Cold-start spawns one vt-graphd AND one vt-daemon; both /health probes
//      prove identity; both owner records on disk.
//   2. Warm reuse of both pre-existing healthy owners.
//   3. `--exclusive` against a pre-existing vt-daemon owner refuses with the
//      vt-daemon-named error.
//   4. `--exclusive` against a pre-existing graph-db owner refuses with the
//      graph-db-named error (regression for the existing BF-346 behaviour).
//   5. `vt serve` SIGTERM does NOT kill either daemon (BF-346 cross-process
//      invariant extended to vt-daemon).
//   6. Idle: a quiet `vt serve` is still alive 2s after ready (guards the
//      `await new Promise(() => {})` idle path).

import {spawn, type ChildProcess} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
    ensureGraphDaemonForVault,
    GraphDbClient,
    type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'
import {
    ensureVtDaemonForVault,
    type EnsureVtDaemonResult,
} from '@vt/vt-daemon-client'
import {
    HealthResponseSchema,
    ownerRecordFile,
    VtDaemonHealthResponseSchema,
    type HealthResponse,
    type OwnerRecord,
    type VtDaemonHealthResponse,
} from '@vt/graph-db-protocol'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const CLI_ENTRYPOINT: string = join(PACKAGE_DIR, 'src/voicetree-cli.ts')
// Resolve the tsx CLI through Node's own module lookup. The worktree layout
// keeps the bulk of dependencies in the main repo's node_modules and only
// symlinks a tiny .bin subset under per-package node_modules, so a hardcoded
// node_modules/.bin/tsx path is unreliable here.
const TSX_REQUIRE = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(TSX_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const NODE_BIN: string = process.execPath
const CLI_TSCONFIG: string = join(PACKAGE_DIR, 'tsconfig.json')
const GRAPHD_SOURCE_BIN: string = join(REPO_ROOT, 'packages/systems/graph-db-server/bin/vt-graphd.ts')
const VTD_SOURCE_BIN: string = join(REPO_ROOT, 'packages/systems/vt-daemon/bin/vtd.ts')
// `node <tsx-cli> <script>` is the worktree-portable equivalent of running
// `tsx <script>` directly — see TSX_CLI_PATH derivation above. Used for both
// graphd and vtd; the per-daemon ensure clients split on whitespace and
// append `--project-root <vault>` / `--vault <vault>` respectively.
const VT_GRAPHD_BIN_OVERRIDE: string = `${NODE_BIN} ${TSX_CLI_PATH} ${GRAPHD_SOURCE_BIN}`
const VT_DAEMON_BIN_OVERRIDE: string = `${NODE_BIN} ${TSX_CLI_PATH} ${VTD_SOURCE_BIN}`

const SERVE_READY_TIMEOUT_MS: number = 20_000
const SERVE_EXIT_TIMEOUT_MS: number = 10_000
const DAEMON_SHUTDOWN_TIMEOUT_MS: number = 5_000
const SCENARIO_TIMEOUT_MS: number = 60_000
const ENSURE_TIMEOUT_MS: number = 20_000

type ServeReady = {
    readonly graphdVerb: 'launched' | 'reused'
    readonly graphdPort: number
    readonly graphdPid: number
    readonly vtdVerb: 'launched' | 'reused'
    readonly vtdUrl: string
    readonly vtdPid: number
}

type ServeHandle = {
    readonly child: ChildProcess
    readonly stdoutBuffer: {value: string}
    readonly stderrBuffer: {value: string}
    readonly ready: Promise<ServeReady>
    readonly exited: Promise<{code: number | null; signal: NodeJS.Signals | null}>
}

function sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms))
}

function buildChildEnv(appSupport: string): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VOICETREE_APP_SUPPORT: appSupport,
        TSX_TSCONFIG_PATH: CLI_TSCONFIG,
        VT_GRAPHD_BIN: VT_GRAPHD_BIN_OVERRIDE,
        VT_DAEMON_BIN: VT_DAEMON_BIN_OVERRIDE,
    }
    delete merged.VT_SESSION
    delete merged.VOICETREE_TERMINAL_ID
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) {
            result[key] = value
        }
    }
    return result
}

function parseServeReady(line: string): ServeReady | null {
    // Format produced by serve.ts (BF-377):
    //   "vt serve: graph-db <verb> on http://127.0.0.1:<port> (pid <pid>),
    //    vt-daemon <verb> on <url> (pid <pid>), vault=<path>"
    const match: RegExpExecArray | null = /^vt serve: graph-db (launched|reused) on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\), vt-daemon (launched|reused) on (\S+) \(pid (\d+)\), vault=/m.exec(line)
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

function spawnServe(args: string[], appSupport: string): ServeHandle {
    const child: ChildProcess = spawn(
        NODE_BIN,
        [TSX_CLI_PATH, CLI_ENTRYPOINT, 'serve', ...args],
        {
            cwd: REPO_ROOT,
            env: buildChildEnv(appSupport),
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

async function stopServe(handle: ServeHandle): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
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

async function readOwnerRecord(vault: string, daemonKind: 'graphd' | 'vtd'): Promise<OwnerRecord | null> {
    try {
        const raw: string = await readFile(ownerRecordFile.pathFor(vault, daemonKind), 'utf8')
        return ownerRecordFile.decode(raw)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

async function fetchGraphdHealth(port: number): Promise<HealthResponse> {
    const response: Response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.ok, `unexpected graphd /health status ${response.status}`).toBe(true)
    const body: unknown = await response.json()
    const parsed = HealthResponseSchema.safeParse(body)
    expect(parsed.success, `graphd /health body did not parse: ${JSON.stringify(body)}`).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    return parsed.data
}

async function fetchVtdHealth(url: string): Promise<VtDaemonHealthResponse> {
    const response: Response = await fetch(`${url}/health`)
    expect(response.ok, `unexpected vtd /health status ${response.status}`).toBe(true)
    const body: unknown = await response.json()
    const parsed = VtDaemonHealthResponseSchema.safeParse(body)
    expect(parsed.success, `vtd /health body did not parse: ${JSON.stringify(body)}`).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    return parsed.data
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
}

async function shutdownGraphd(port: number): Promise<void> {
    const client: GraphDbClient = new GraphDbClient({baseUrl: `http://127.0.0.1:${port}`})
    await client.shutdown().catch(() => undefined)
}

async function waitForDaemonExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (!isPidAlive(pid)) return true
        await sleep(50)
    }
    return false
}

async function ensureCleanVault(vault: string): Promise<void> {
    const graphdRecord: OwnerRecord | null = await readOwnerRecord(vault, 'graphd')
    if (graphdRecord !== null && graphdRecord.port !== null) {
        await shutdownGraphd(graphdRecord.port)
        if (graphdRecord.pid) {
            await waitForDaemonExit(graphdRecord.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
        }
    }
    const vtdRecord: OwnerRecord | null = await readOwnerRecord(vault, 'vtd')
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
        await rm(join(vault, '.voicetree', file), {force: true}).catch(() => undefined)
    }
}

describe.skipIf(process.env.CI_SANDBOX === '1')(
    'BF-377 vt serve two-ensure wrapper',
    () => {
        let root: string
        let vault: string
        let appSupport: string
        const serveHandles: ServeHandle[] = []

        beforeEach(async () => {
            root = await mkdtemp(join(tmpdir(), 'vt-serve-owner-'))
            vault = join(root, 'vault')
            appSupport = join(root, 'app-support')
            await mkdir(join(vault, '.voicetree'), {recursive: true})
            await mkdir(appSupport, {recursive: true})
        })

        afterEach(async () => {
            for (const handle of serveHandles) {
                await stopServe(handle).catch(() => undefined)
            }
            serveHandles.length = 0
            await ensureCleanVault(vault).catch(() => undefined)
            await rm(root, {recursive: true, force: true}).catch(() => undefined)
        })

        it(
            'cold-start: spawns one vt-graphd AND one vt-daemon; both /health probes prove identity',
            async () => {
                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)

                const ready: ServeReady = await handle.ready
                expect(ready.graphdVerb).toBe('launched')
                expect(ready.graphdPort).toBeGreaterThan(0)
                expect(ready.graphdPid).toBeGreaterThan(0)
                expect(ready.vtdVerb).toBe('launched')
                expect(ready.vtdUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
                expect(ready.vtdPid).toBeGreaterThan(0)
                expect(ready.vtdPid).not.toBe(ready.graphdPid)

                const graphdRecord: OwnerRecord | null = await readOwnerRecord(vault, 'graphd')
                expect(graphdRecord, 'graphd.owner.json must exist after launch').not.toBeNull()
                expect(graphdRecord!.canonicalVault).toBe(resolve(vault))
                expect(graphdRecord!.pid).toBe(ready.graphdPid)
                expect(graphdRecord!.port).toBe(ready.graphdPort)

                const vtdRecord: OwnerRecord | null = await readOwnerRecord(vault, 'vtd')
                expect(vtdRecord, 'vtd.owner.json must exist after launch').not.toBeNull()
                expect(vtdRecord!.canonicalVault).toBe(resolve(vault))
                expect(vtdRecord!.pid).toBe(ready.vtdPid)

                const graphdHealth: HealthResponse = await fetchGraphdHealth(ready.graphdPort)
                expect(graphdHealth.owner, 'graphd owner block must be present').not.toBeNull()
                expect(graphdHealth.owner!.canonicalVault).toBe(resolve(vault))
                expect(graphdHealth.owner!.ownerNonce).toBe(graphdRecord!.ownerNonce)
                expect(graphdHealth.owner!.port).toBe(ready.graphdPort)
                expect(graphdHealth.owner!.pid).toBe(ready.graphdPid)

                const vtdHealth: VtDaemonHealthResponse = await fetchVtdHealth(ready.vtdUrl)
                expect(vtdHealth.daemonKind).toBe('vtd')
                expect(vtdHealth.owner, 'vtd owner block must be present').not.toBeNull()
                expect(vtdHealth.owner!.ownerNonce).toBe(vtdRecord!.ownerNonce)
                expect(vtdHealth.owner!.pid).toBe(ready.vtdPid)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'warm reuse: pre-existing graphd AND vtd owners are reused',
            async () => {
                process.env.VOICETREE_APP_SUPPORT = appSupport
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                const graphdPrewarm: EnsureGraphDaemonResult = await ensureGraphDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(graphdPrewarm.launched).toBe(true)
                const vtdPrewarm: EnsureVtDaemonResult = await ensureVtDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_DAEMON_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(vtdPrewarm.launched).toBe(true)

                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)

                const ready: ServeReady = await handle.ready
                expect(ready.graphdVerb).toBe('reused')
                expect(ready.graphdPort).toBe(graphdPrewarm.port)
                expect(ready.graphdPid).toBe(graphdPrewarm.pid)
                expect(ready.vtdVerb).toBe('reused')
                expect(ready.vtdUrl).toBe(vtdPrewarm.client.baseUrl)
                expect(ready.vtdPid).toBe(vtdPrewarm.pid)

                const graphdHealth: HealthResponse = await fetchGraphdHealth(ready.graphdPort)
                expect(graphdHealth.owner!.ownerNonce).toBe(graphdPrewarm.ownerNonce)

                const vtdHealth: VtDaemonHealthResponse = await fetchVtdHealth(ready.vtdUrl)
                expect(vtdHealth.owner!.ownerNonce).toBe(vtdPrewarm.ownerNonce)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            '--exclusive refuses when a vt-daemon owner already exists; leaves the existing daemon alive',
            async () => {
                process.env.VOICETREE_APP_SUPPORT = appSupport
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                // Prewarm vt-daemon (which adopts/spawns its own graphd
                // sibling per BF-371). Then tear down ONLY the graphd so
                // vt serve's graph-db ensure step launches fresh and its
                // exclusive check passes, allowing the vt-daemon-named
                // exclusive-conflict error to surface (graph-db's check
                // runs first by construction in serve.ts).
                const vtdPrewarm: EnsureVtDaemonResult = await ensureVtDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_DAEMON_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(vtdPrewarm.launched).toBe(true)
                const graphdRecord: OwnerRecord | null = await readOwnerRecord(vault, 'graphd')
                expect(graphdRecord, 'vtd should have brought up a graphd sibling').not.toBeNull()
                expect(graphdRecord!.port).not.toBeNull()
                await shutdownGraphd(graphdRecord!.port!)
                await waitForDaemonExit(graphdRecord!.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
                // vt-daemon must still be alive — the BF-346 invariant.
                expect(isPidAlive(vtdPrewarm.pid)).toBe(true)

                const handle: ServeHandle = spawnServe(['--vault', vault, '--exclusive'], appSupport)
                serveHandles.push(handle)

                const exitResult = await waitForExclusiveRefusal(handle)
                expect(exitResult.code).not.toBe(0)
                expect(handle.stderrBuffer.value).toMatch(/--exclusive/)
                expect(handle.stderrBuffer.value).toMatch(/vt-daemon owner already exists/)

                // The existing vt-daemon must be untouched by the refusal.
                expect(isPidAlive(vtdPrewarm.pid)).toBe(true)
                const healthAfter: VtDaemonHealthResponse = await fetchVtdHealth(vtdPrewarm.client.baseUrl)
                expect(healthAfter.owner!.ownerNonce).toBe(vtdPrewarm.ownerNonce)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            '--exclusive refuses when a graph-db owner already exists; leaves the existing daemon alive',
            async () => {
                process.env.VOICETREE_APP_SUPPORT = appSupport
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                const graphdPrewarm: EnsureGraphDaemonResult = await ensureGraphDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(graphdPrewarm.launched).toBe(true)

                const handle: ServeHandle = spawnServe(['--vault', vault, '--exclusive'], appSupport)
                serveHandles.push(handle)

                const exitResult = await waitForExclusiveRefusal(handle)
                expect(exitResult.code).not.toBe(0)
                expect(handle.stderrBuffer.value).toMatch(/--exclusive/)
                expect(handle.stderrBuffer.value).toMatch(/graph-db owner already exists/)

                // The existing graph-db owner must be untouched.
                expect(isPidAlive(graphdPrewarm.pid)).toBe(true)
                const healthAfter: HealthResponse = await fetchGraphdHealth(graphdPrewarm.port)
                expect(healthAfter.owner!.ownerNonce).toBe(graphdPrewarm.ownerNonce)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'vt serve SIGTERM does NOT kill either daemon (BF-346 cross-process invariant)',
            async () => {
                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)
                const ready: ServeReady = await handle.ready

                handle.child.kill('SIGTERM')
                await handle.exited

                // Both daemon pids must still be alive after vt serve exits.
                expect(isPidAlive(ready.graphdPid), 'graphd must outlive vt serve').toBe(true)
                expect(isPidAlive(ready.vtdPid), 'vt-daemon must outlive vt serve').toBe(true)

                // And they must remain reachable on their bound ports.
                const graphdHealth: HealthResponse = await fetchGraphdHealth(ready.graphdPort)
                expect(graphdHealth.owner!.pid).toBe(ready.graphdPid)
                const vtdHealth: VtDaemonHealthResponse = await fetchVtdHealth(ready.vtdUrl)
                expect(vtdHealth.owner!.pid).toBe(ready.vtdPid)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'idle: vt serve stays alive and daemons remain reachable 2s after ready',
            async () => {
                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)
                const ready: ServeReady = await handle.ready

                await sleep(2_000)

                expect(handle.child.exitCode, 'vt serve must still be running').toBeNull()
                expect(handle.child.signalCode, 'vt serve must not have been signalled').toBeNull()
                const graphdHealth: HealthResponse = await fetchGraphdHealth(ready.graphdPort)
                expect(graphdHealth.owner!.pid).toBe(ready.graphdPid)
                const vtdHealth: VtDaemonHealthResponse = await fetchVtdHealth(ready.vtdUrl)
                expect(vtdHealth.owner!.pid).toBe(ready.vtdPid)
            },
            SCENARIO_TIMEOUT_MS,
        )
    },
)

async function waitForExclusiveRefusal(
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
