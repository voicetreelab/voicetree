/**
 * Black-box test for the per-project VTD binding (post-Phase-2 / BF-375).
 *
 * Spawns a REAL VTD child (`packages/systems/vt-daemon/bin/vtd.ts`, BF-371)
 * via `bindVtDaemonForProject`, then asserts on observable side effects:
 *   - the spawned child's `/health` response,
 *   - the on-disk `rpc.port` + `auth-token` files VTD wrote,
 *   - the spawned child's process liveness (via `kill(pid, 0)`),
 *   - the `getDaemonUrl` / `getAuthToken` accessors the renderer reaches
 *     via IPC.
 *
 * Why a real VTD child rather than the in-process fake-vtd that BF-373's
 * own tests use: this is a wiring test for the production
 * `daemon-url-binding.ts` consumed by Electron Main. The format of the
 * published auth token (`/^[0-9a-f]{64}$/`, written by `generateAuthToken`
 * inside the real binary) is part of the surface this module exposes to
 * the renderer; a fake-vtd that publishes a different token shape would
 * not exercise it.
 *
 * Per CLAUDE.md (no internal mocks, no `toHaveBeenCalledWith`): every
 * assertion is on a value an out-of-process consumer could read (file,
 * /health response, `kill(pid, 0)`). The `vi.mock('electron')` is
 * inherited from the global setup (`e2e-tests/setup.ts`) because
 * `app-electron-state.getVoicetreeHomePath` is in the import graph via the
 * client's transitive deps.
 *
 * Regression guard preserved from pre-Phase-2: the writer/reader
 * path-divergence bug that ENOENT'd the renderer when the bound project
 * had a `voicetree-{day}-{month}` write subdir. The
 * `makeProjectWithDatedWriteSubdir` helper is unchanged; the assertion
 * is now that VTD's `rpc.port` writer keys off `projectRoot` (NOT the
 * writeFolderPath), and `getDaemonUrl` resolves correctly regardless of
 * where the renderer would look on disk.
 *
 * Serialisation: tier-2 electron tests already serialise via
 * `flock /tmp/vt-electron-tests.lock`; the vitest-level lock for this
 * file is the same — invoke `flock /tmp/vt-electron-tests.lock npx
 * vitest run …` per `feedback_serialize_electron_tests_via_flock`.
 * vitest itself runs in singleFork + fileParallelism: false (see
 * `webapp/vite.config.ts`) so within a single process there is no
 * intra-file race; the flock guards cross-test-suite collisions on
 * fixed ports + shared voicetreeHome.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromHere = createRequire(import.meta.url)
const TEST_FILE_DIR: string = path.dirname(fileURLToPath(import.meta.url))

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => path.join(os.tmpdir(), `daemon-url-binding-test-userdata-${Date.now()}`)),
    },
}))

import {
    bindVtDaemonForProject,
    getAuthToken,
    getDaemonUrl,
    unbindVtDaemon,
} from './daemon-url-binding'
import {shutdownTmuxServer} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-server.ts'

interface ProjectLayout {
    readonly projectRoot: string
    readonly writeSubdir: string
}

/**
 * Resolve the absolute path of `packages/systems/vt-daemon/bin/vtd.ts`
 * by walking up from this test file rather than via `require.resolve`.
 * The daemon package (vt-daemon) intentionally does not expose
 * `./bin/vtd.ts` in its `exports` field — the binary is reached via the
 * package's `bin` entry, not as an importable subpath — so a
 * `requireFromHere.resolve('@vt-daemon/bin/vtd.ts')` would fail with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. Walking up from the test file is the
 * cleanest workaround that does not depend on a hardcoded absolute path.
 */
function resolveRealVtdBinPath(): string {
    // Test-file dir is webapp/src/shell/edge/main/runtime/electron/daemon.
    // Walk up to the repo root, then to packages/systems/vt-daemon/bin/vtd.ts.
    const repoRoot: string = path.resolve(TEST_FILE_DIR, '..', '..', '..', '..', '..', '..', '..', '..')
    return path.join(repoRoot, 'packages', 'systems', 'vt-daemon', 'bin', 'vtd.ts')
}

function resolveTsxLoaderPath(): string {
    // tsx is hoisted to the root node_modules; we resolve it via
    // createRequire(import.meta.url) so a future package-manager bump
    // still works.
    return requireFromHere.resolve('tsx')
}

function buildVtDaemonBinCommand(): string {
    // The `VT_DAEMON_BIN` env var is parsed by `@vt/vt-daemon-client`'s
    // command resolver as `<cmd> <args...>` (split on whitespace, with
    // `--project <project>` appended). We avoid spaces in any path component
    // by sanity-checking; if the repo lives under a path with spaces,
    // a more sophisticated quoting protocol would be needed.
    const node: string = process.execPath
    const tsxPath: string = resolveTsxLoaderPath()
    const vtdPath: string = resolveRealVtdBinPath()
    for (const part of [node, tsxPath, vtdPath]) {
        if (/\s/.test(part)) {
            throw new Error(
                `daemon-url-binding.test: path contains whitespace, VT_DAEMON_BIN parser would split it: ${part}`,
            )
        }
    }
    return `${node} --import ${tsxPath} ${vtdPath}`
}

function buildFakeVtDaemonBinCommand(): string {
    const node: string = process.execPath
    const repoRoot: string = path.resolve(TEST_FILE_DIR, '..', '..', '..', '..', '..', '..', '..', '..')
    const fakeVtdPath: string = path.join(
        repoRoot,
        'packages',
        'systems',
        'vt-daemon-client',
        'src',
        '__tests__',
        'fixtures',
        'fake-vtd.mjs',
    )
    for (const part of [node, fakeVtdPath]) {
        if (/\s/.test(part)) {
            throw new Error(
                `daemon-url-binding.test: path contains whitespace, VT_DAEMON_BIN parser would split it: ${part}`,
            )
        }
    }
    return `${node} ${fakeVtdPath}`
}

interface SpawnedVtdRecord {
    pid: number
    projectPath: string
}

const harness: {
    spawnedVtdPids: SpawnedVtdRecord[]
    createdRoots: string[]
    voicetreeHomeTmp: string | null
    savedEnv: {
        VT_DAEMON_BIN: string | undefined
        VT_GRAPHD_BIN: string | undefined
        VOICETREE_DAEMON_URL: string | undefined
        VOICETREE_HOME_PATH: string | undefined
        FAKE_VTD_ENV_SNAPSHOT_PATH: string | undefined
        VOICETREE_PARENT_PID: string | undefined
    }
} = {
    spawnedVtdPids: [],
    createdRoots: [],
    voicetreeHomeTmp: null,
    savedEnv: {
        VT_DAEMON_BIN: undefined,
        VT_GRAPHD_BIN: undefined,
        VOICETREE_DAEMON_URL: undefined,
        VOICETREE_HOME_PATH: undefined,
        FAKE_VTD_ENV_SNAPSHOT_PATH: undefined,
        VOICETREE_PARENT_PID: undefined,
    },
}

async function makeProjectWithDatedWriteSubdir(): Promise<ProjectLayout> {
    const projectRoot: string = await fs.mkdtemp(
        path.join(os.tmpdir(), 'daemon-url-binding-test-'),
    )
    // Reproduce the on-disk shape that surfaced the writer/reader
    // path-divergence bug: a `voicetree-{day}-{month}` write subdir
    // underneath the projectRoot. `bindVtDaemonForProject` is invoked
    // with projectRoot; the spawned VTD's rpc.port writer also keys
    // off the projectRoot. Pre-fix, renderer infra looked up the port
    // under the writeFolderPath (this subdir) and ENOENT'd.
    const writeSubdir: string = path.join(projectRoot, 'voicetree-22-5')
    await fs.mkdir(writeSubdir, { recursive: true })
    harness.createdRoots.push(projectRoot)
    return { projectRoot, writeSubdir }
}

function tryKill(pid: number, signal: NodeJS.Signals | 0 = 'SIGTERM'): void {
    try {
        process.kill(pid, signal)
    } catch {
        // already gone
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

async function waitForExit(pid: number, timeoutMs: number = 5_000): Promise<void> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (!isAlive(pid)) return
        await new Promise((res) => setTimeout(res, 50))
    }
}

beforeEach(async (): Promise<void> => {
    harness.spawnedVtdPids = []
    harness.createdRoots = []
    harness.savedEnv = {
        VT_DAEMON_BIN: process.env.VT_DAEMON_BIN,
        VT_GRAPHD_BIN: process.env.VT_GRAPHD_BIN,
        VOICETREE_DAEMON_URL: process.env.VOICETREE_DAEMON_URL,
        VOICETREE_HOME_PATH: process.env.VOICETREE_HOME_PATH,
        FAKE_VTD_ENV_SNAPSHOT_PATH: process.env.FAKE_VTD_ENV_SNAPSHOT_PATH,
        VOICETREE_PARENT_PID: process.env.VOICETREE_PARENT_PID,
    }
    delete process.env.VOICETREE_DAEMON_URL
    // Point the ensure path at the real vtd.ts binary. The spec's
    // recipe uses `VT_DAEMON_BIN` rather than the (private) `bin`
    // option of `ensureVtDaemonForProject` because `bindVtDaemonForProject`
    // intentionally exposes no options pass-through — the env var is
    // the only sanctioned override surface for non-default vtd paths.
    process.env.VT_DAEMON_BIN = buildVtDaemonBinCommand()
    // Quarantine vtd's voicetreeHome so tests don't write into the user's
    // `~/Library/Application Support/Voicetree`. vtd respects this env
    // var (see `defaultVoicetreeHomePath` in `bin/vtd.ts`).
    harness.voicetreeHomeTmp = await fs.mkdtemp(
        path.join(os.tmpdir(), 'daemon-url-binding-test-appsupport-'),
    )
    process.env.VOICETREE_HOME_PATH = harness.voicetreeHomeTmp
    // Pin the VTD parent-pid watchdog to this test process so the spawn
    // takes itself down when the test process exits (defensive — the
    // explicit pid-kill in afterEach is the primary cleanup).
    process.env.VOICETREE_PARENT_PID = String(process.pid)
})

afterEach(async (): Promise<void> => {
    // Clear the binding cache so it cannot survive into the next test.
    await unbindVtDaemon().catch((): void => {})

    // Kill each spawned VTD child by recorded pid. `bindVtDaemonForProject`
    // intentionally never kills children (BF-346 invariant: VTD outlives
    // any single Electron Main), so the test owns this cleanup. Also
    // reap the sibling vt-graphd that vtd spawns by looking up its
    // owner record.
    for (const record of harness.spawnedVtdPids) {
        const graphdPid: number | null = await readGraphdPidIfPresent(record.projectPath)
        tryKill(record.pid, 'SIGTERM')
        if (graphdPid !== null) tryKill(graphdPid, 'SIGTERM')
        await waitForExit(record.pid, 5_000)
        if (graphdPid !== null) await waitForExit(graphdPid, 5_000)
        if (isAlive(record.pid)) tryKill(record.pid, 'SIGKILL')
        if (graphdPid !== null && isAlive(graphdPid)) tryKill(graphdPid, 'SIGKILL')
    }
    harness.spawnedVtdPids = []

    // Restore env.
    restoreEnv('VT_DAEMON_BIN', harness.savedEnv.VT_DAEMON_BIN)
    restoreEnv('VT_GRAPHD_BIN', harness.savedEnv.VT_GRAPHD_BIN)
    restoreEnv('VOICETREE_DAEMON_URL', harness.savedEnv.VOICETREE_DAEMON_URL)
    restoreEnv('VOICETREE_HOME_PATH', harness.savedEnv.VOICETREE_HOME_PATH)
    restoreEnv('FAKE_VTD_ENV_SNAPSHOT_PATH', harness.savedEnv.FAKE_VTD_ENV_SNAPSHOT_PATH)
    restoreEnv('VOICETREE_PARENT_PID', harness.savedEnv.VOICETREE_PARENT_PID)

    if (harness.voicetreeHomeTmp !== null) {
        await shutdownTmuxServer({ voicetreeHomePath: harness.voicetreeHomeTmp }).catch(() => undefined)
        await fs.rm(harness.voicetreeHomeTmp, { recursive: true, force: true }).catch(() => undefined)
        harness.voicetreeHomeTmp = null
    }

    while (harness.createdRoots.length > 0) {
        const root: string = harness.createdRoots.pop()!
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
})

function restoreEnv(key: string, prior: string | undefined): void {
    if (prior === undefined) delete process.env[key]
    else process.env[key] = prior
}

async function readGraphdPidIfPresent(projectPath: string): Promise<number | null> {
    try {
        const raw: string = await fs.readFile(
            path.join(projectPath, '.voicetree', 'graphd.owner.json'),
            'utf-8',
        )
        const parsed: unknown = JSON.parse(raw)
        if (
            typeof parsed === 'object'
            && parsed !== null
            && 'pid' in parsed
            && typeof (parsed as { pid: unknown }).pid === 'number'
        ) {
            return (parsed as { pid: number }).pid
        }
        return null
    } catch {
        return null
    }
}

async function recordVtdPid(projectPath: string): Promise<void> {
    const raw: string = await fs.readFile(
        path.join(projectPath, '.voicetree', 'vtd.owner.json'),
        'utf-8',
    )
    const parsed: { pid: number; port: number | null } = JSON.parse(raw)
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) {
        throw new Error(`recordVtdPid: invalid pid in owner record: ${parsed.pid}`)
    }
    harness.spawnedVtdPids.push({ pid: parsed.pid, projectPath })
}

// 60s per test: real vtd cold-start includes ensureGraphDaemonForProject
// (sibling graphd spawn), tmux server start, BF-371's auth + HTTP bind,
// plus heartbeats. Local hot runs settle in <10s; this leaves headroom
// for slow CI workers.
const TEST_TIMEOUT_MS: number = 60_000

describe('bindVtDaemonForProject — real VTD child via ensure path', () => {
    test(
        'after bind: getDaemonUrl resolves to the spawned VTD, /health round-trips with daemonKind: vtd',
        async (): Promise<void> => {
            const { projectRoot } = await makeProjectWithDatedWriteSubdir()
            const snapshot = await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            const url: string = await getDaemonUrl()
            expect(url).toBe(snapshot.url)
            expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

            const response: Response = await fetch(`${url}/health`)
            expect(response.status).toBe(200)
            const body: { daemonKind: string; owner: { pid: number } | null } =
                await response.json()
            expect(body.daemonKind).toBe('vtd')
            expect(body.owner?.pid).toBe(snapshot.pid)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'after bind: getAuthToken returns a 64-hex token matching <project>/.voicetree/auth-token on disk',
        async (): Promise<void> => {
            const { projectRoot } = await makeProjectWithDatedWriteSubdir()
            await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            const token: string = await getAuthToken()
            expect(token).toMatch(/^[0-9a-f]{64}$/)

            const onDisk: string = await fs.readFile(
                path.join(projectRoot, '.voicetree', 'auth-token'),
                'utf-8',
            )
            expect(onDisk.trim()).toBe(token)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'writer/reader path-divergence regression: rpc.port lands at projectRoot, ENOENT under writeSubdir',
        async (): Promise<void> => {
            const { projectRoot, writeSubdir } = await makeProjectWithDatedWriteSubdir()
            const snapshot = await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            const rpcPortAtProjectRoot: string = await fs.readFile(
                path.join(projectRoot, '.voicetree', 'rpc.port'),
                'utf-8',
            )
            // VTD writes the port file with a trailing newline (see
            // `writeRpcPortFile` in `@vt/vt-rpc`).
            expect(Number.parseInt(rpcPortAtProjectRoot.trim(), 10)).toBe(
                Number.parseInt(snapshot.url.split(':').pop()!, 10),
            )
            await expect(
                fs.readFile(path.join(writeSubdir, '.voicetree', 'rpc.port'), 'utf-8'),
            ).rejects.toMatchObject({ code: 'ENOENT' })
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'before any bind: getDaemonUrl and getAuthToken reject with daemon_unreachable',
        async (): Promise<void> => {
            await expect(getDaemonUrl()).rejects.toThrow(/daemon_unreachable/)
            await expect(getAuthToken()).rejects.toThrow(/daemon_unreachable/)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'after unbind: accessors reject with daemon_unreachable, but the spawned VTD child is still alive (BF-346 invariant)',
        async (): Promise<void> => {
            const { projectRoot } = await makeProjectWithDatedWriteSubdir()
            const snapshot = await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            await unbindVtDaemon()

            await expect(getDaemonUrl()).rejects.toThrow(/daemon_unreachable/)
            await expect(getAuthToken()).rejects.toThrow(/daemon_unreachable/)

            // The VTD child outlives Main's binding handle. `kill(pid, 0)`
            // succeeds iff the process is still alive (or a zombie).
            expect(isAlive(snapshot.pid)).toBe(true)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        '$VOICETREE_DAEMON_URL override: getDaemonUrl returns it without bringing up a VTD child',
        async (): Promise<void> => {
            process.env.VOICETREE_DAEMON_URL = 'http://example.test:1234'
            const url: string = await getDaemonUrl()
            expect(url).toBe('http://example.test:1234')
            // No bind was performed, so no VTD pid should have been
            // recorded for cleanup — sanity check the override path
            // truly bypasses the ensure call.
            expect(harness.spawnedVtdPids).toHaveLength(0)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'idempotent re-bind for the same project returns the same pid/port (no respawn)',
        async (): Promise<void> => {
            const { projectRoot } = await makeProjectWithDatedWriteSubdir()
            const first = await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            const second = await bindVtDaemonForProject(projectRoot)

            expect(second.pid).toBe(first.pid)
            expect(second.url).toBe(first.url)
            expect(second.ownerNonce).toBe(first.ownerNonce)
            expect(second.token).toBe(first.token)

            // The on-disk owner record's pid is still the first spawn.
            const owner: { pid: number } = JSON.parse(
                await fs.readFile(
                    path.join(projectRoot, '.voicetree', 'vtd.owner.json'),
                    'utf-8',
                ),
            )
            expect(owner.pid).toBe(first.pid)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'bind uses the current process env when spawning VTD after startup pins app support',
        async (): Promise<void> => {
            const envSnapshotPath: string = path.join(harness.voicetreeHomeTmp!, 'fake-vtd-env.json')
            process.env.VT_DAEMON_BIN = buildFakeVtDaemonBinCommand()
            process.env.FAKE_VTD_ENV_SNAPSHOT_PATH = envSnapshotPath

            const { projectRoot } = await makeProjectWithDatedWriteSubdir()
            await bindVtDaemonForProject(projectRoot)
            await recordVtdPid(projectRoot)

            const snapshot: {
                readonly VOICETREE_HOME_PATH: string | null
                readonly VT_DAEMON_BIN: string | null
            } = JSON.parse(await fs.readFile(envSnapshotPath, 'utf-8'))
            expect(snapshot.VOICETREE_HOME_PATH).toBe(harness.voicetreeHomeTmp)
            expect(snapshot.VT_DAEMON_BIN).toBe(process.env.VT_DAEMON_BIN)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'project-swap leaves the prior VTD child alive (BF-346 invariant)',
        async (): Promise<void> => {
            const { projectRoot: projectA } = await makeProjectWithDatedWriteSubdir()
            const first = await bindVtDaemonForProject(projectA)
            await recordVtdPid(projectA)

            const { projectRoot: projectB } = await makeProjectWithDatedWriteSubdir()
            const second = await bindVtDaemonForProject(projectB)
            await recordVtdPid(projectB)

            expect(second.pid).not.toBe(first.pid)
            expect(second.projectPath).toBe(projectB)

            // The first VTD child is still alive — Main does not own
            // its lifetime; the bounded cleanup is VTD's parent-pid
            // watchdog (BF-369), which fires when this test process
            // exits, not when we swap projects.
            expect(isAlive(first.pid)).toBe(true)

            // /health on projectA's VTD still responds.
            const healthResponse: Response = await fetch(`${first.url}/health`)
            expect(healthResponse.status).toBe(200)
            const body: { owner: { pid: number } | null } = await healthResponse.json()
            expect(body.owner?.pid).toBe(first.pid)
        },
        TEST_TIMEOUT_MS,
    )
})
