// BF-223 — CLI cold-start e2e (north-star test for decouple-ui-from-graph-server).
//
// Spawns the real `vt` CLI against a tmp vault with no daemon running and
// asserts the full cold-start / session-isolation / clean-shutdown loop.
//
// Deviation from card: the card calls for `pnpm --filter webapp build` + `node
// dist/cli/voicetree-cli.js`. The repo's `tsc -b` currently OOMs on main
// (flagged in fay-bf218-complete.md), so this test runs the TypeScript
// entrypoint directly via the repo-local `tsx` binary. The CLI process path
// (argv parsing, ensureDaemon auto-launch, port-file handshake, HTTP
// round-trip) is still fully exercised — only the bundler is bypassed.

import {spawn, type ChildProcess} from 'node:child_process'
import {access, mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_FILE_DIR, '../../../../../..')
const CLI_ENTRYPOINT: string = join(REPO_ROOT, 'webapp/src/shell/edge/main/cli/voicetree-cli.ts')
const TSX_BIN: string = join(REPO_ROOT, 'node_modules/.bin/tsx')

const SCENARIO_TIMEOUT_MS: number = 30_000
const DAEMON_READY_TIMEOUT_MS: number = 10_000
const CLI_EXIT_TIMEOUT_MS: number = 20_000

type SpawnResult = {
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
}

type SpawnOptions = {
    env?: Record<string, string | undefined>
}

function sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms))
}

function buildChildEnv(appSupport: string, overrides?: Record<string, string | undefined>): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VOICETREE_APP_SUPPORT: appSupport,
        ...overrides,
    }

    // Strip inherited terminal/session identifiers that would otherwise taint
    // the spawned CLI's session resolution.
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

function spawnCli(
    args: string[],
    appSupport: string,
    opts: SpawnOptions = {},
): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const child: ChildProcess = spawn(TSX_BIN, [CLI_ENTRYPOINT, ...args], {
            cwd: REPO_ROOT,
            env: buildChildEnv(appSupport, opts.env),
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer): void => {
            stdoutChunks.push(chunk)
        })
        child.stderr?.on('data', (chunk: Buffer): void => {
            stderrChunks.push(chunk)
        })

        const killTimer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`CLI did not exit within ${CLI_EXIT_TIMEOUT_MS}ms: vt ${args.join(' ')}`))
        }, CLI_EXIT_TIMEOUT_MS)

        child.on('error', (err: Error) => {
            clearTimeout(killTimer)
            rejectPromise(err)
        })
        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            clearTimeout(killTimer)
            resolvePromise({
                code,
                signal,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            })
        })
    })
}

async function waitForPortFile(vault: string, timeoutMs: number): Promise<number> {
    const portFile: string = join(vault, '.voicetree', 'graphd.port')
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const raw: string = await readFile(portFile, 'utf8')
            const port: number = Number(raw.trim())
            if (Number.isInteger(port) && port > 0) {
                return port
            }
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err
            }
        }
        await sleep(50)
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${portFile}`)
}

async function waitUntilMissing(path: string, timeoutMs: number): Promise<boolean> {
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            await access(path)
        } catch {
            return true
        }
        await sleep(50)
    }
    return false
}

async function readLockedPid(vault: string): Promise<number | null> {
    try {
        const raw: string = await readFile(join(vault, '.voicetree', 'graphd.lock'), 'utf8')
        const pid: number = Number(raw.trim())
        return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
        }
        throw err
    }
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        const code: string | undefined = (err as NodeJS.ErrnoException).code
        return code === 'EPERM'
    }
}

async function killAllGraphd(vault: string): Promise<void> {
    const pid: number | null = await readLockedPid(vault)
    if (pid !== null && isPidAlive(pid)) {
        try {
            process.kill(pid, 'SIGTERM')
        } catch {
            // Already gone.
        }
        const exited: boolean = await waitUntilMissing(
            join(vault, '.voicetree', 'graphd.port'),
            5_000,
        )
        if (!exited && isPidAlive(pid)) {
            try {
                process.kill(pid, 'SIGKILL')
            } catch {
                // Already gone.
            }
        }
    }
    await rm(join(vault, '.voicetree', 'graphd.port'), {force: true})
    await rm(join(vault, '.voicetree', 'graphd.lock'), {force: true})
}

function parseJsonStdout<T>(result: SpawnResult): T {
    try {
        return JSON.parse(result.stdout) as T
    } catch (err) {
        throw new Error(
            `Failed to parse CLI stdout as JSON (exit ${result.code}):\n${result.stdout}\n---stderr---\n${result.stderr}\n--- (${(err as Error).message})`,
        )
    }
}

describe.skipIf(process.env.CI_SANDBOX === '1')(
    'BF-223 CLI cold-start e2e (north-star)',
    () => {
        let vault: string
        let readDir: string
        let appSupport: string
        let root: string

        beforeAll(async () => {
            root = await mkdtemp(join(tmpdir(), 'vt-cli-coldstart-'))
            vault = join(root, 'vault')
            readDir = join(root, 'read-dir')
            appSupport = join(root, 'app-support')
            await mkdir(join(vault, '.voicetree'), {recursive: true})
            await mkdir(readDir, {recursive: true})
            await mkdir(appSupport, {recursive: true})
        })

        afterAll(async () => {
            await killAllGraphd(vault).catch(() => {})
            await rm(root, {recursive: true, force: true})
        })

        it(
            'Scenario A — cold start: auto-launches vt-graphd and persists a new read path',
            async () => {
                const portFile: string = join(vault, '.voicetree', 'graphd.port')
                // Pre-check: no daemon running.
                await expect(stat(portFile)).rejects.toMatchObject({code: 'ENOENT'})

                const addResult: SpawnResult = await spawnCli(
                    ['vault', 'add-read-path', readDir, '--vault', vault, '--json'],
                    appSupport,
                )
                expect(addResult.code, `add-read-path stderr: ${addResult.stderr}`).toBe(0)

                const addPayload: {readPaths: string[]} = parseJsonStdout(addResult)
                expect(addPayload.readPaths).toContain(readDir)

                // Port file now exists; daemon PID is alive.
                const portAfterAdd: number = await waitForPortFile(vault, DAEMON_READY_TIMEOUT_MS)
                expect(portAfterAdd).toBeGreaterThan(0)

                const daemonPid: number | null = await readLockedPid(vault)
                expect(daemonPid, 'expected graphd.lock to record a pid').not.toBeNull()
                expect(isPidAlive(daemonPid!)).toBe(true)

                // Second invocation must reuse the same daemon (same port, same pid).
                const showResult: SpawnResult = await spawnCli(
                    ['vault', 'show', '--vault', vault, '--json'],
                    appSupport,
                )
                expect(showResult.code, `vault show stderr: ${showResult.stderr}`).toBe(0)

                const showPayload: {readPaths: string[]; vaultPath: string} = parseJsonStdout(showResult)
                expect(showPayload.vaultPath).toBe(vault)
                expect(showPayload.readPaths).toContain(readDir)

                const portAfterShow: number = await waitForPortFile(vault, 1_000)
                expect(portAfterShow).toBe(portAfterAdd)
                expect(await readLockedPid(vault)).toBe(daemonPid)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'Scenario B — session isolation: two sessions hold disjoint collapse sets',
            async () => {
                const create1: SpawnResult = await spawnCli(
                    ['session', 'create', '--vault', vault, '--json'],
                    appSupport,
                )
                expect(create1.code, `session create 1 stderr: ${create1.stderr}`).toBe(0)
                const sid1: string = parseJsonStdout<{sessionId: string}>(create1).sessionId

                const create2: SpawnResult = await spawnCli(
                    ['session', 'create', '--vault', vault, '--json'],
                    appSupport,
                )
                expect(create2.code, `session create 2 stderr: ${create2.stderr}`).toBe(0)
                const sid2: string = parseJsonStdout<{sessionId: string}>(create2).sessionId

                expect(sid1).not.toEqual(sid2)

                const folderId: string = '/some/folder'
                const collapse: SpawnResult = await spawnCli(
                    ['view', 'collapse', folderId, '--vault', vault, '--session', sid1, '--json'],
                    appSupport,
                )
                expect(collapse.code, `view collapse stderr: ${collapse.stderr}`).toBe(0)
                expect(parseJsonStdout<{collapseSet: string[]}>(collapse).collapseSet).toContain(folderId)

                const showSid2: SpawnResult = await spawnCli(
                    ['view', 'show', '--vault', vault, '--session', sid2, '--json'],
                    appSupport,
                )
                expect(showSid2.code, `view show sid2 stderr: ${showSid2.stderr}`).toBe(0)
                expect(parseJsonStdout<{collapseSet: string[]}>(showSid2).collapseSet).not.toContain(folderId)

                const showSid1: SpawnResult = await spawnCli(
                    ['view', 'show', '--vault', vault, '--session', sid1, '--json'],
                    appSupport,
                )
                expect(showSid1.code, `view show sid1 stderr: ${showSid1.stderr}`).toBe(0)
                expect(parseJsonStdout<{collapseSet: string[]}>(showSid1).collapseSet).toContain(folderId)
            },
            SCENARIO_TIMEOUT_MS,
        )

        it(
            'Scenario C — clean shutdown: daemon exits, files disappear, next call cold-starts',
            async () => {
                const portFile: string = join(vault, '.voicetree', 'graphd.port')
                const lockFile: string = join(vault, '.voicetree', 'graphd.lock')

                const portBeforeShutdown: number = await waitForPortFile(vault, 1_000)
                const client: GraphDbClient = new GraphDbClient({
                    baseUrl: `http://127.0.0.1:${portBeforeShutdown}`,
                })
                await expect(client.shutdown()).resolves.toMatchObject({ok: true})

                // Daemon tears down: port + lock files removed.
                expect(await waitUntilMissing(portFile, 5_000)).toBe(true)
                expect(await waitUntilMissing(lockFile, 5_000)).toBe(true)

                // A subsequent CLI invocation must cold-start a fresh daemon.
                const showAgain: SpawnResult = await spawnCli(
                    ['vault', 'show', '--vault', vault, '--json'],
                    appSupport,
                )
                expect(showAgain.code, `post-shutdown vault show stderr: ${showAgain.stderr}`).toBe(0)

                const portAfterColdStart: number = await waitForPortFile(vault, DAEMON_READY_TIMEOUT_MS)
                expect(portAfterColdStart).toBeGreaterThan(0)
                expect(portAfterColdStart).not.toBe(portBeforeShutdown)
            },
            SCENARIO_TIMEOUT_MS,
        )
    },
)
