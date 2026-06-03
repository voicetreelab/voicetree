/**
 * Load-time guard: opening a FRESH project must stay on the concurrent
 * daemon-spawn fast path — the property that keeps a fresh load under a second.
 *
 * WHY THIS EXISTS
 * Opening a project used to be near-instant because vt-graphd ran in-process.
 * After the BF-375 "Phase 2" split, `openProject()` spawns two independent Node
 * child daemons — VTD (vt-daemon) and vt-graphd — and blocks on their HTTP
 * readiness. VTD's own startup itself ensures vt-graphd and only reports healthy
 * *after* that nested graphd boot resolves. A naive serial
 * `await bindVtDaemonForProject()` → `await setActiveProjectAndEnsureDaemon()`
 * therefore paid for BOTH cold Node boots back-to-back (~777ms measured against
 * built dists). `openProject` now kicks the graphd ensure off concurrently with
 * the VTD bind; the cross-process spawn lock coalesces it with VTD's nested
 * ensure into exactly one child whose boot OVERLAPS VTD's (~368ms measured) —
 * see the concurrency comment in openProject.ts.
 *
 * WHAT THIS ASSERTS (and why not a raw wall-clock)
 * The decisive, environment-independent signature of the fix is *who spawns
 * vt-graphd*. Because `openProject` now ensures graphd from electron-main
 * BEFORE binding VTD, electron-main wins the spawn lock and ACQUIRES graphd
 * itself → an owner diagnostic `{ kind: 'acquired', callerKind: 'electron-main' }`.
 * In the old serial order VTD spawned graphd first and electron-main only
 * `reuse`d it (no `acquired` from electron-main). We assert the `acquired`
 * signature plus the single-vt-graphd coalescing invariant.
 *
 * A raw `<1000ms` wall-clock is deliberately NOT the gate: this harness runs the
 * daemons from TypeScript SOURCE via tsx (every cold boot re-transpiles), which
 * is ~3.4x slower than the built `.mjs` dists that ship to users — so an
 * absolute millisecond bar here would measure tsx overhead, not the product. The
 * elapsed load time is logged for visibility; the structural assertions are what
 * guarantee the path that delivers sub-second loads in production.
 */

import {spawnSync} from 'node:child_process'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeAll, afterAll, describe, expect, it, vi} from 'vitest'

import {openProject, stopFileWatching} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {clearDaemonClientCache} from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import {GraphDbClient, subscribeOwnerDiagnostics, type OwnerDiagnosticListener} from '@vt/graph-db-client'
import {initGraphModel} from '@vt/graph-model'

// The diagnostic event type is the sole argument of the listener — derive it
// here rather than reaching into @vt/graph-db-protocol (not on webapp's tsc paths).
type OwnerDiagnosticEvent = Parameters<OwnerDiagnosticListener>[0]

const TIMEOUT_MS = 60_000 as const

vi.mock('@/shell/edge/main/runtime/state/app-electron-state', () => ({
    getVoicetreeHomePath: vi.fn(() => '/tmp/fresh-project-load-voicetree-home'),
    getMainWindow: vi.fn(() => ({
        webContents: {send: vi.fn(), isDestroyed: vi.fn(() => false)},
        isDestroyed: vi.fn(() => false),
    })),
    setMainWindow: vi.fn(),
}))

vi.mock('electron', () => ({
    app: {getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-fresh-load')},
}))

// Setup/teardown state held in one const cell (mutated fields, never
// reassigned) so this file adds no module-level `let`/`var` bindings.
const suite: {
    tempRoot: string | null
    originalVoicetreeHomePath: string | undefined
    originalParentPid: string | undefined
} = {tempRoot: null, originalVoicetreeHomePath: undefined, originalParentPid: undefined}

/** Pids of vt-graphd / vt-daemon (vtd) children bound to this project, via `ps`. */
function daemonPidsForProject(project: string): number[] {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return []
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {encoding: 'utf8', timeout: 5000})
    if (result.status !== 0 || !result.stdout) return []
    const canonical = path.resolve(project)
    const pids: number[] = []
    for (const line of result.stdout.split('\n')) {
        // graphd is launched with `--project-root <project>`; vtd with `--project <project>`.
        const match = /\b(vt-graphd|vtd)\.\w+\b.*--project(?:-root)?\s+(\S+)/.exec(line)
        if (!match || path.resolve(match[2]) !== canonical) continue
        const pid = Number(line.trim().split(/\s+/, 1)[0])
        if (Number.isInteger(pid) && pid > 0) pids.push(pid)
    }
    return pids
}

function countGraphdForProject(project: string): number {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return 0
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {encoding: 'utf8', timeout: 5000})
    if (result.status !== 0 || !result.stdout) return 0
    const re = new RegExp(`vt-graphd\\.\\w+\\b.*--project-root\\s+${path.resolve(project)}(\\s|$)`)
    return result.stdout.split('\n').filter(line => re.test(line)).length
}

async function shutdownDaemonsForProject(project: string): Promise<void> {
    const client = await GraphDbClient.connect({project}).catch(() => null)
    await client?.shutdown().catch(() => undefined)
    // VTD has no Electron parent in tests (its parent-pid watchdog never fires),
    // so terminate every daemon child bound to this project directly.
    for (const pid of daemonPidsForProject(project)) {
        try {
            process.kill(pid, 'SIGTERM')
        } catch {
            // already gone
        }
    }
}

describe('Fresh project load time (BF-375 daemon-spawn concurrency)', () => {
    beforeAll(async () => {
        suite.originalVoicetreeHomePath = process.env.VOICETREE_HOME_PATH
        // Pin the daemon parent-pid watchdog to this (live) test process. The
        // process env can carry a STALE VOICETREE_PARENT_PID inherited from an
        // outer launcher; a dead pid makes every spawned daemon self-exit via
        // PARENT_GONE before it can report healthy. In production electron-main
        // is the live launcher — this models that.
        suite.originalParentPid = process.env.VOICETREE_PARENT_PID
        process.env.VOICETREE_PARENT_PID = String(process.pid)
        suite.tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fresh-project-load-'))
        process.env.VOICETREE_HOME_PATH = path.join(suite.tempRoot, 'voicetree-home')
        initGraphModel({
            onGraphCleared: (): void => undefined,
            onWatchingStarted: (): void => undefined,
        })
    }, TIMEOUT_MS)

    afterEach(async () => {
        await stopFileWatching()
        clearDaemonClientCache()
        vi.clearAllMocks()
    })

    afterAll(async () => {
        if (suite.tempRoot) {
            // Best-effort shutdown of any daemon spawned for a fresh project under tempRoot.
            const entries = await fs.readdir(suite.tempRoot).catch(() => [] as string[])
            for (const entry of entries) {
                await shutdownDaemonsForProject(path.join(suite.tempRoot, entry)).catch(() => undefined)
            }
            await fs.rm(suite.tempRoot, {recursive: true, force: true})
            suite.tempRoot = null
        }
        if (suite.originalVoicetreeHomePath === undefined) delete process.env.VOICETREE_HOME_PATH
        else process.env.VOICETREE_HOME_PATH = suite.originalVoicetreeHomePath
        if (suite.originalParentPid === undefined) delete process.env.VOICETREE_PARENT_PID
        else process.env.VOICETREE_PARENT_PID = suite.originalParentPid
    }, TIMEOUT_MS)

    it('opens a brand-new empty project on the concurrent fast path (electron-main spawns the sole vt-graphd)', async () => {
        if (!suite.tempRoot) throw new Error('tempRoot not initialized')
        // A genuinely fresh project: empty directory, no saved config, no daemon.
        const project = path.join(suite.tempRoot, `fresh-${process.pid}`)
        await fs.mkdir(project, {recursive: true})
        // openProject realpath-normalizes the project (resolves symlinks, e.g.
        // macOS /tmp → /private/tmp), and the daemon diagnostics carry that
        // canonical form — so match against the realpath, not path.resolve.
        const canonical = await fs.realpath(project)
        clearDaemonClientCache()

        // Capture vt-graphd owner-lifecycle diagnostics for this project only.
        const graphdEvents: OwnerDiagnosticEvent[] = []
        const unsubscribe = subscribeOwnerDiagnostics((event: OwnerDiagnosticEvent): void => {
            if (path.resolve(event.canonicalProject) === canonical) graphdEvents.push(event)
        })

        let elapsedMs: number
        try {
            const startedAt = performance.now()
            await openProject(project)
            elapsedMs = performance.now() - startedAt
        } finally {
            unsubscribe()
        }

        // Observable boundary: the graph daemon is reachable for this project.
        const client = await GraphDbClient.connect({project})
        await client.getGraph()

        // Fast-path signature: electron-main ACQUIRED (spawned) vt-graphd itself,
        // because the graphd ensure is kicked off concurrently with — and ahead
        // of — the VTD bind. In the old serial order VTD spawned graphd first and
        // electron-main would only `reuse` it (this assertion would then fail).
        const electronMainAcquired = graphdEvents.some(
            (event): boolean => event.kind === 'acquired' && event.callerKind === 'electron-main',
        )
        expect(
            electronMainAcquired,
            `expected electron-main to acquire vt-graphd concurrently; saw events: ${graphdEvents
                .map(event => `${event.kind}/${event.callerKind}`)
                .join(', ')}`,
        ).toBe(true)

        // Coalescing invariant: exactly one vt-graphd despite VTD also ensuring
        // one — the cross-process spawn lock collapsed both into a single child.
        if (process.platform === 'darwin' || process.platform === 'linux') {
            const graphdCount = countGraphdForProject(project)
            expect(graphdCount, `expected ≤1 vt-graphd for project, found ${graphdCount}`)
                .toBeLessThanOrEqual(1)
        }

        // Logged for visibility — NOT asserted (this harness runs daemons from
        // tsx source, ~3.4x slower than the built dists that ship to users, where
        // the concurrent path measures ~368ms).
        console.log(`[fresh-load] openProject completed in ${Math.round(elapsedMs)}ms (tsx-source harness)`)
    }, TIMEOUT_MS)
})
