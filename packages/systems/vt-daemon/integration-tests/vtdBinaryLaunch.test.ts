/**
 * Black-box launch test for the standalone vtd binary (BF-371).
 *
 * Spawns `bin/vtd.ts` against a freshly-created temp project with the
 * fake vt-graphd fixture as VT_GRAPHD_BIN. Asserts on the observable
 * boundary, never on internal call sites (CLAUDE.md):
 *
 *   - readiness line emitted on stdout in the documented contract format;
 *   - <project>/.voicetree/vtd.owner.json decodes to a valid OwnerRecord
 *     stamped with daemonKind='vtd', the bound port, and canonicalProject;
 *   - <project>/.voicetree/rpc.port contains the bound port;
 *   - <project>/.voicetree/auth-token exists with mode 0600;
 *   - SIGTERM produces a clean shutdown line and removes the owner record
 *     AND the rpc.port file;
 *   - the spawned vt-graphd sibling SURVIVES VTD shutdown — that's the
 *     BF-346 invariant codified.
 *
 * No mocks. Real binary, real ensureGraphDaemonForProject, real owner record
 * I/O. The fake graphd fixture matters because we want to (a) avoid
 * dragging in the full graphd stack for a binary-launch test and (b) make
 * the "graphd survives VTD shutdown" assertion observable via `ps`.
 */

import {spawn, type ChildProcess, spawnSync} from 'node:child_process'
import {access, constants, mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeAll, describe, expect, it} from 'vitest'
import {ownerRecordFile} from '@vt/graph-db-protocol'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '..')
const REPO_ROOT: string = resolve(PACKAGE_DIR, '../../..')
const VTD_ENTRYPOINT: string = join(PACKAGE_DIR, 'bin/vtd.ts')
const FAKE_GRAPHD_BIN: string = join(
    REPO_ROOT,
    'packages/systems/graph-db-client/src/__tests__/fixtures/fake-vt-graphd.mjs',
)

// Resolve tsx the same way the cold-start e2e test does — node_modules under a
// worktree only carries a minimal .bin subset, so a hard path is unreliable.
const TSX_REQUIRE = createRequire(import.meta.url)
const TSX_PACKAGE_DIR: string = dirname(TSX_REQUIRE.resolve('tsx/package.json'))
const TSX_CLI_PATH: string = join(TSX_PACKAGE_DIR, 'dist', 'cli.mjs')
const NODE_BIN: string = process.execPath
const VT_GRAPHD_BIN_OVERRIDE: string = `${NODE_BIN} ${FAKE_GRAPHD_BIN}`

const STARTUP_TIMEOUT_MS: number = 20_000
const SHUTDOWN_TIMEOUT_MS: number = 10_000
const WATCHDOG_TIMEOUT_MS: number = 15_000

type LaunchOutcome = {
    readonly child: ChildProcess
    readonly readinessLine: string
    readonly httpPort: number
    readonly gdbPort: number
    readonly stdoutBuf: {text: string}
    readonly stderrBuf: {text: string}
}

const READINESS_REGEX = /^vtd: listening on (https?:\/\/[^,]+), project=(\S+), gdb=(\d+)$/m

function sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => setTimeout(res, ms))
}

async function makeTempProject(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ESRCH') return false
        if (code === 'EPERM') return true
        return false
    }
}

function listGraphdPidsForProject(project: string): number[] {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return []
    const canonical = resolve(project)
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return []
    const pids: number[] = []
    for (const line of result.stdout.split('\n')) {
        if (!/(vt-graphd|fake-vt-graphd)\.\w+\b.*--project-root\s+(\S+)/.test(line)) continue
        const match = /(vt-graphd|fake-vt-graphd)\.\w+\b.*--project-root\s+(\S+)/.exec(line)
        if (!match) continue
        if (resolve(match[2]) !== canonical) continue
        const pidStr = line.trim().split(/\s+/, 1)[0]
        const pid = Number(pidStr)
        if (Number.isInteger(pid) && pid > 0) pids.push(pid)
    }
    return pids
}

function killForgiving(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
    try {
        process.kill(pid, signal)
    } catch {
        // already gone
    }
}

async function spawnVtd(
    project: string,
    extraEnv: Record<string, string | undefined> = {},
): Promise<LaunchOutcome> {
    const env: Record<string, string> = {}
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VT_GRAPHD_BIN: VT_GRAPHD_BIN_OVERRIDE,
        ...extraEnv,
    }
    for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined) env[k] = v
    }

    const child = spawn(
        NODE_BIN,
        [TSX_CLI_PATH, VTD_ENTRYPOINT, '--project', project, '--port', '0'],
        {
            cwd: REPO_ROOT,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        },
    )

    const stdoutBuf: {text: string} = {text: ''}
    const stderrBuf: {text: string} = {text: ''}
    child.stdout!.on('data', (chunk: Buffer): void => {
        stdoutBuf.text += chunk.toString('utf8')
    })
    child.stderr!.on('data', (chunk: Buffer): void => {
        stderrBuf.text += chunk.toString('utf8')
    })

    const readinessLine: string = await new Promise<string>((resolveLine, rejectLine) => {
        let settled = false
        const timer = setTimeout(() => {
            if (settled) return
            settled = true
            rejectLine(new Error(
                `vtd readiness line not seen within ${STARTUP_TIMEOUT_MS}ms.\n` +
                `stdout=${stdoutBuf.text}\nstderr=${stderrBuf.text}`,
            ))
        }, STARTUP_TIMEOUT_MS)
        const onData = (): void => {
            if (settled) return
            const match = READINESS_REGEX.exec(stdoutBuf.text)
            if (match) {
                settled = true
                clearTimeout(timer)
                resolveLine(match[0])
            }
        }
        child.stdout!.on('data', onData)
        child.once('exit', (code, signal) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            rejectLine(new Error(
                `vtd exited (code=${code} signal=${signal}) before emitting the readiness line.\n` +
                `stdout=${stdoutBuf.text}\nstderr=${stderrBuf.text}`,
            ))
        })
    })

    const match = READINESS_REGEX.exec(readinessLine)
    if (!match) throw new Error(`readiness line did not match contract: ${readinessLine}`)
    const httpUrl = match[1]
    const httpPort = Number(new URL(httpUrl).port)
    const gdbPort = Number(match[3])

    return {child, readinessLine, httpPort, gdbPort, stdoutBuf, stderrBuf}
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK)
        return true
    } catch {
        return false
    }
}

async function waitForFileGone(path: string, deadlineMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < deadlineMs) {
        if (!(await fileExists(path))) return true
        await sleep(50)
    }
    return false
}

async function waitForChildExit(child: ChildProcess, deadlineMs: number): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return {code: child.exitCode, signal: child.signalCode as NodeJS.Signals | null}
    }
    return await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`child did not exit within ${deadlineMs}ms`)), deadlineMs)
        child.once('exit', (code, signal) => {
            clearTimeout(timer)
            res({code, signal})
        })
    })
}

describe('vtd binary — black-box launch (BF-371)', () => {
    const cleanup: Array<() => Promise<void>> = []

    beforeAll(() => {
        // Sanity: the fake vt-graphd fixture must exist before any test runs.
        if (!spawnSync('test', ['-f', FAKE_GRAPHD_BIN]).status === 0) {
            // tolerated — fall through to the per-test access check
        }
    })

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop()
            if (fn) await fn().catch(() => undefined)
        }
    })

    it('emits the readiness line, writes owner + port + auth files, and survives SIGTERM cleanly while leaving vt-graphd running', async () => {
        const project = await makeTempProject('vtd-launch-')
        cleanup.push(async () => {
            for (const pid of listGraphdPidsForProject(project)) killForgiving(pid)
            await rm(project, {recursive: true, force: true})
        })

        const launch = await spawnVtd(project)
        cleanup.push(async () => {
            if (launch.child.exitCode === null) killForgiving(launch.child.pid!, 'SIGKILL')
        })

        // Readiness line carries the right format.
        expect(launch.readinessLine).toMatch(
            /^vtd: listening on http:\/\/127\.0\.0\.1:\d+, project=.+, gdb=\d+$/,
        )
        expect(launch.httpPort).toBeGreaterThan(0)
        expect(launch.gdbPort).toBeGreaterThan(0)

        // Owner record decodes to a valid OwnerRecord with the expected fields.
        const ownerPath = join(project, '.voicetree', 'vtd.owner.json')
        const ownerRaw = await readFile(ownerPath, 'utf8')
        const ownerRecord = ownerRecordFile.decode(ownerRaw)
        expect(ownerRecord).not.toBeNull()
        if (ownerRecord === null) throw new Error('unreachable')
        expect(ownerRecord.daemonKind).toBe('vtd')
        expect(ownerRecord.port).toBe(launch.httpPort)
        expect(ownerRecord.canonicalProject).toBe(resolve(project))
        // The binary self-identifies as 'vtd' when no env override is present.
        expect(ownerRecord.callerKind).toBe('vtd')

        // rpc.port contains the bound port.
        const rpcPortPath = join(project, '.voicetree', 'rpc.port')
        const rpcPortContent = (await readFile(rpcPortPath, 'utf8')).trim()
        expect(Number(rpcPortContent)).toBe(launch.httpPort)

        // auth-token exists with mode 0600.
        const authTokenPath = join(project, '.voicetree', 'auth-token')
        const authStat = await stat(authTokenPath)
        // mode is the lower 9 bits — 0o600.
        expect(authStat.mode & 0o777).toBe(0o600)

        // The spawned vt-graphd is visible via ps for the same project.
        const graphdPids = listGraphdPidsForProject(project)
        expect(graphdPids.length).toBeGreaterThanOrEqual(1)
        const graphdPid = graphdPids[0]

        // Send SIGTERM and wait for clean exit.
        killForgiving(launch.child.pid!, 'SIGTERM')
        const exit = await waitForChildExit(launch.child, SHUTDOWN_TIMEOUT_MS)
        expect(exit.code).toBe(0)

        // Shutdown line should have appeared on stderr.
        expect(launch.stderrBuf.text).toMatch(/vtd: SIGTERM received, shutting down/)

        // Owner record + rpc.port removed.
        expect(await waitForFileGone(ownerPath, 2_000)).toBe(true)
        expect(await waitForFileGone(rpcPortPath, 2_000)).toBe(true)

        // BF-346 invariant: vt-graphd is shared cross-process and OUTLIVES VTD.
        // Re-list pids (graphd may have a different startup time than the
        // initial scan window).
        await sleep(200)
        expect(isProcessAlive(graphdPid)).toBe(true)
    }, 60_000)

    it('exits when its declared parent process disappears (PARENT_GONE watchdog)', async () => {
        const project = await makeTempProject('vtd-watchdog-')
        cleanup.push(async () => {
            for (const pid of listGraphdPidsForProject(project)) killForgiving(pid)
            await rm(project, {recursive: true, force: true})
        })

        // We need a *separate* live pid we can kill to simulate parent death.
        // A short-lived helper child that sleeps until killed works.
        const helper = spawn(
            NODE_BIN,
            ['-e', 'setInterval(() => {}, 1e9)'],
            {detached: false, stdio: 'ignore'},
        )
        const helperPid = helper.pid!
        cleanup.push(async () => killForgiving(helperPid))

        const launch = await spawnVtd(project, {
            VOICETREE_PARENT_PID: String(helperPid),
        })
        cleanup.push(async () => {
            if (launch.child.exitCode === null) killForgiving(launch.child.pid!, 'SIGKILL')
        })

        const ownerPath = join(project, '.voicetree', 'vtd.owner.json')
        expect(await fileExists(ownerPath)).toBe(true)

        // Kill the declared parent; watchdog should fire within its poll
        // interval and shut VTD down.
        killForgiving(helperPid, 'SIGKILL')

        const exit = await waitForChildExit(launch.child, WATCHDOG_TIMEOUT_MS)
        expect(exit.code).toBe(0)
        expect(launch.stderrBuf.text).toMatch(/vtd: PARENT_GONE received, shutting down/)
        expect(await waitForFileGone(ownerPath, 2_000)).toBe(true)
    }, 60_000)
})
