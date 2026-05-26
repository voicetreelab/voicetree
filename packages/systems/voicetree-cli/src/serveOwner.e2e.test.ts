// BF-346 — `vt serve` owner-aware ensure path.
//
// Black-box: spawn the real `vt serve` CLI and assert observable outcomes —
// stdout ready line, /health owner identity, on-disk graphd.owner.json
// contents, exit code, and stderr fragments. No internal mocks.
//
// Cold-start, warm-reuse, and --exclusive conflict scenarios cover the three
// production CLI behaviours the BF-346 spec requires:
//
//   1. vt serve cold-starts → ensureGraphDaemonForVault claims + spawns exactly
//      one vt-graphd; /health proves owner identity.
//   2. vt serve with an existing healthy owner → reuses the same port; stdout
//      reports "reused"; no second vt-graphd spawn.
//   3. vt serve --exclusive against an existing owner → non-zero exit, clear
//      "owner already exists" error; existing daemon untouched.

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
    HealthResponseSchema,
    ownerRecordFile,
    type HealthResponse,
    type OwnerRecord,
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
// `node <tsx-cli> <script>` is the worktree-portable equivalent of running
// `tsx <script>` directly — see TSX_CLI_PATH derivation above.
const VT_GRAPHD_BIN_OVERRIDE: string = `${NODE_BIN} ${TSX_CLI_PATH} ${GRAPHD_SOURCE_BIN}`

const SERVE_READY_TIMEOUT_MS: number = 20_000
const SERVE_EXIT_TIMEOUT_MS: number = 10_000
const DAEMON_SHUTDOWN_TIMEOUT_MS: number = 5_000
const SCENARIO_TIMEOUT_MS: number = 45_000

type ServeReady = {
    readonly verb: 'launched' | 'reused'
    readonly daemonPort: number
    readonly daemonPid: number
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
    // Format produced by serve.ts:
    //   "vt serve: graph-db <verb> on http://127.0.0.1:<port> (pid <pid>), ..."
    const match: RegExpExecArray | null =
        /^vt serve: graph-db (launched|reused) on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/m.exec(line)
    if (!match) return null
    const verb: 'launched' | 'reused' = match[1] === 'launched' ? 'launched' : 'reused'
    return {verb, daemonPort: Number(match[2]), daemonPid: Number(match[3])}
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

async function readOwnerRecord(vault: string): Promise<OwnerRecord | null> {
    try {
        const raw: string = await readFile(ownerRecordFile.pathFor(vault), 'utf8')
        return ownerRecordFile.decode(raw)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

async function fetchHealth(port: number): Promise<HealthResponse> {
    const response: Response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.ok, `unexpected /health status ${response.status}`).toBe(true)
    const body: unknown = await response.json()
    const parsed = HealthResponseSchema.safeParse(body)
    expect(parsed.success, `health body did not parse: ${JSON.stringify(body)}`).toBe(true)
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

async function shutdownDaemon(port: number): Promise<void> {
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
    const record: OwnerRecord | null = await readOwnerRecord(vault)
    if (record !== null && record.port !== null) {
        await shutdownDaemon(record.port)
        if (record.pid) {
            await waitForDaemonExit(record.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
        }
    }
    await rm(join(vault, '.voicetree', 'graphd.owner.json'), {force: true})
    await rm(join(vault, '.voicetree', 'graphd.lock'), {force: true})
    await rm(join(vault, '.voicetree', 'graphd.port'), {force: true})
}

describe.skipIf(process.env.CI_SANDBOX === '1')(
    'BF-346 vt serve owner-aware ensure',
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
            'cold-start: spawns one vt-graphd owner and /health proves identity',
            async () => {
                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)

                const ready: ServeReady = await handle.ready
                expect(ready.verb).toBe('launched')
                expect(ready.daemonPort).toBeGreaterThan(0)
                expect(ready.daemonPid).toBeGreaterThan(0)

                const record: OwnerRecord | null = await readOwnerRecord(vault)
                expect(record, 'graphd.owner.json must exist after launch').not.toBeNull()
                expect(record!.canonicalVault).toBe(resolve(vault))
                expect(record!.pid).toBe(ready.daemonPid)
                expect(record!.port).toBe(ready.daemonPort)

                const health: HealthResponse = await fetchHealth(ready.daemonPort)
                expect(health.owner, 'owner block must be present').not.toBeNull()
                expect(health.owner!.canonicalVault).toBe(resolve(vault))
                expect(health.owner!.ownerNonce).toBe(record!.ownerNonce)
                expect(health.owner!.port).toBe(ready.daemonPort)
                expect(health.owner!.pid).toBe(ready.daemonPid)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'warm reuse: pre-existing owner is reused without spawning a second daemon',
            async () => {
                process.env.VOICETREE_APP_SUPPORT = appSupport
                const prewarm: EnsureGraphDaemonResult = await ensureGraphDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: 20_000},
                )
                expect(prewarm.launched).toBe(true)

                const recordBefore: OwnerRecord | null = await readOwnerRecord(vault)
                expect(recordBefore).not.toBeNull()

                const handle: ServeHandle = spawnServe(['--vault', vault], appSupport)
                serveHandles.push(handle)

                const ready: ServeReady = await handle.ready
                expect(ready.verb).toBe('reused')
                expect(ready.daemonPort).toBe(prewarm.port)
                expect(ready.daemonPid).toBe(prewarm.pid)

                const recordAfter: OwnerRecord | null = await readOwnerRecord(vault)
                expect(recordAfter, 'owner record must persist').not.toBeNull()
                expect(recordAfter!.ownerNonce).toBe(recordBefore!.ownerNonce)
                expect(recordAfter!.pid).toBe(recordBefore!.pid)
                expect(recordAfter!.port).toBe(recordBefore!.port)

                const health: HealthResponse = await fetchHealth(ready.daemonPort)
                expect(health.owner!.ownerNonce).toBe(prewarm.ownerNonce)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'conflict: --exclusive refuses to start when another owner already exists',
            async () => {
                process.env.VOICETREE_APP_SUPPORT = appSupport
                const prewarm: EnsureGraphDaemonResult = await ensureGraphDaemonForVault(
                    vault,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: 20_000},
                )
                expect(prewarm.launched).toBe(true)

                const handle: ServeHandle = spawnServe(['--vault', vault, '--exclusive'], appSupport)
                serveHandles.push(handle)

                const exitResult: {code: number | null; signal: NodeJS.Signals | null} =
                    await Promise.race([
                        handle.exited,
                        handle.ready.then(
                            () => {
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
                            // Ready promise rejects when child exits before ready —
                            // that's exactly the expected path. Pull the exit info.
                            return await handle.exited
                        }
                        throw err
                    })

                expect(exitResult.code).not.toBe(0)
                expect(handle.stderrBuffer.value).toMatch(/--exclusive/)
                expect(handle.stderrBuffer.value).toMatch(/already exists/)

                // The existing owner must be untouched by the refusal.
                expect(isPidAlive(prewarm.pid)).toBe(true)
                const healthAfter: HealthResponse = await fetchHealth(prewarm.port)
                expect(healthAfter.owner!.ownerNonce).toBe(prewarm.ownerNonce)
            },
            SCENARIO_TIMEOUT_MS,
        )
    },
)
