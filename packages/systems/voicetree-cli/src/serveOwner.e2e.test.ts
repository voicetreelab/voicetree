// `vt serve` two-ensure wrapper — black-box e2e spec.
//
// Spawns the real `vt serve` CLI as a child process and asserts observable
// outcomes — stdout ready line, /health owner identity for both daemons,
// on-disk graphd.owner.json + vtd.owner.json contents, exit code, stderr
// fragments, cross-process lifetime of the spawned daemons. No internal mocks.
// The spawn / health / owner-record / teardown effect helpers live in
// `serveOwner.e2e.harness.ts`.
//
// Seven scenarios cover the two-ensure wrapper contract:
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
//   7. Induced vt-daemon ensure failure tears down the graph-db daemon this
//      invocation just launched — no orphan left behind, exit non-zero.
//
// The vt-daemon ensure is exercised through the high-level
// `ensureNodeVtDaemonForProject(runtime, project, caller, options)` entry —
// both inside `vt serve` (the subject) and in this file's own prewarm setup
// (`prewarmVtd`). The low-level `ensureVtDaemonForProject(state, deps, …)`
// takes the single-flight state + deps as its first two positional args and
// must NOT be called with a `(project, caller, options)` arity.

import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {EnsureGraphDaemonResult} from '@vt/graph-db-client'
import type {EnsureVtDaemonResult, VtDaemonClient} from '@vt/vt-daemon-client'
import type {
    HealthResponse,
    OwnerRecord,
    VtDaemonHealthResponse,
} from '@vt/graph-db-protocol'
import {
    DAEMON_SHUTDOWN_TIMEOUT_MS,
    ENSURE_TIMEOUT_MS,
    SCENARIO_TIMEOUT_MS,
    VT_DAEMON_BIN_FAILING,
    VT_DAEMON_BIN_OVERRIDE,
    VT_GRAPHD_BIN_OVERRIDE,
    ensureCleanProject,
    fetchGraphdHealth,
    fetchVtdHealth,
    graphdHealthReachable,
    isPidAlive,
    prewarmGraphd,
    prewarmVtd,
    readOwnerRecord,
    shutdownGraphd,
    sleep,
    spawnServe,
    stopServe,
    waitForDaemonExit,
    waitForExclusiveRefusal,
    waitForVtdFailureExit,
    type ServeHandle,
    type ServeReady,
} from './serveOwner.e2e.harness'

describe.skipIf(process.env.CI_SANDBOX === '1')(
    'vt serve two-ensure wrapper',
    () => {
        let root: string
        let project: string
        let voicetreeHome: string
        const serveHandles: ServeHandle[] = []

        beforeEach(async () => {
            root = await mkdtemp(join(tmpdir(), 'vt-serve-owner-'))
            project = join(root, 'project')
            voicetreeHome = join(root, 'voicetree-home')
            await mkdir(join(project, '.voicetree'), {recursive: true})
            await mkdir(voicetreeHome, {recursive: true})
        })

        afterEach(async () => {
            for (const handle of serveHandles) {
                await stopServe(handle).catch(() => undefined)
            }
            serveHandles.length = 0
            await ensureCleanProject(project).catch(() => undefined)
            await rm(root, {recursive: true, force: true}).catch(() => undefined)
        })

        it(
            'cold-start: spawns one vt-graphd AND one vt-daemon; both /health probes prove identity',
            async () => {
                const handle: ServeHandle = spawnServe(['--project', project], voicetreeHome)
                serveHandles.push(handle)

                const ready: ServeReady = await handle.ready
                expect(ready.graphdVerb).toBe('launched')
                expect(ready.graphdPort).toBeGreaterThan(0)
                expect(ready.graphdPid).toBeGreaterThan(0)
                expect(ready.vtdVerb).toBe('launched')
                expect(ready.vtdUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
                expect(ready.vtdPid).toBeGreaterThan(0)
                expect(ready.vtdPid).not.toBe(ready.graphdPid)

                const graphdRecord: OwnerRecord | null = await readOwnerRecord(project, 'graphd')
                expect(graphdRecord, 'graphd.owner.json must exist after launch').not.toBeNull()
                expect(graphdRecord!.canonicalProject).toBe(resolve(project))
                expect(graphdRecord!.pid).toBe(ready.graphdPid)
                expect(graphdRecord!.port).toBe(ready.graphdPort)

                const vtdRecord: OwnerRecord | null = await readOwnerRecord(project, 'vtd')
                expect(vtdRecord, 'vtd.owner.json must exist after launch').not.toBeNull()
                expect(vtdRecord!.canonicalProject).toBe(resolve(project))
                expect(vtdRecord!.pid).toBe(ready.vtdPid)

                const graphdHealth: HealthResponse = await fetchGraphdHealth(ready.graphdPort)
                expect(graphdHealth.owner, 'graphd owner block must be present').not.toBeNull()
                expect(graphdHealth.owner!.canonicalProject).toBe(resolve(project))
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
                process.env.VOICETREE_HOME_PATH = voicetreeHome
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                const graphdPrewarm: EnsureGraphDaemonResult = await prewarmGraphd(
                    project,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(graphdPrewarm.launched).toBe(true)
                const vtdPrewarm: EnsureVtDaemonResult<VtDaemonClient> = await prewarmVtd(
                    project,
                    'test',
                    {bin: VT_DAEMON_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(vtdPrewarm.launched).toBe(true)

                const handle: ServeHandle = spawnServe(['--project', project], voicetreeHome)
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
                process.env.VOICETREE_HOME_PATH = voicetreeHome
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                // Prewarm vt-daemon (which adopts/spawns its own graphd
                // sibling per BF-371). Then tear down ONLY the graphd so
                // vt serve's graph-db ensure step launches fresh and its
                // exclusive check passes, allowing the vt-daemon-named
                // exclusive-conflict error to surface (graph-db's check
                // runs first by construction in serve.ts).
                const vtdPrewarm: EnsureVtDaemonResult<VtDaemonClient> = await prewarmVtd(
                    project,
                    'test',
                    {bin: VT_DAEMON_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(vtdPrewarm.launched).toBe(true)
                const graphdRecord: OwnerRecord | null = await readOwnerRecord(project, 'graphd')
                expect(graphdRecord, 'vtd should have brought up a graphd sibling').not.toBeNull()
                expect(graphdRecord!.port).not.toBeNull()
                await shutdownGraphd(graphdRecord!.port!)
                await waitForDaemonExit(graphdRecord!.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
                // vt-daemon must still be alive — the BF-346 invariant.
                expect(isPidAlive(vtdPrewarm.pid)).toBe(true)

                const handle: ServeHandle = spawnServe(['--project', project, '--exclusive'], voicetreeHome)
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
                process.env.VOICETREE_HOME_PATH = voicetreeHome
                process.env.VT_GRAPHD_BIN = VT_GRAPHD_BIN_OVERRIDE
                process.env.VT_DAEMON_BIN = VT_DAEMON_BIN_OVERRIDE

                const graphdPrewarm: EnsureGraphDaemonResult = await prewarmGraphd(
                    project,
                    'test',
                    {bin: VT_GRAPHD_BIN_OVERRIDE, timeoutMs: ENSURE_TIMEOUT_MS},
                )
                expect(graphdPrewarm.launched).toBe(true)

                const handle: ServeHandle = spawnServe(['--project', project, '--exclusive'], voicetreeHome)
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
                const handle: ServeHandle = spawnServe(['--project', project], voicetreeHome)
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
                const handle: ServeHandle = spawnServe(['--project', project], voicetreeHome)
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

        it(
            'induced vt-daemon failure: tears down the just-launched graph-db daemon (no orphan), exits non-zero',
            async () => {
                // Point vt serve at a vt-daemon bin that exits non-zero
                // immediately and never publishes an owner, with a short
                // ensure timeout so the vt-daemon ensure fails deterministically.
                // graph-db ensure runs FIRST and succeeds, launching a fresh
                // graphd — the orphan candidate. The fix must tear it down.
                const handle: ServeHandle = spawnServe(
                    ['--project', project],
                    voicetreeHome,
                    VT_DAEMON_BIN_FAILING,
                )
                serveHandles.push(handle)

                const exitResult = await waitForVtdFailureExit(handle)
                expect(exitResult.code, 'vt serve must exit non-zero on vt-daemon ensure failure').not.toBe(0)
                expect(handle.stderrBuffer.value).toMatch(/failed to ensure vt-daemon owner/)

                // The graph-db daemon this invocation launched must have been
                // torn down — assert on the observable side effect (its
                // /health is no longer reachable and its pid is gone), not on
                // any internal call.
                const graphdRecord: OwnerRecord | null = await readOwnerRecord(project, 'graphd')
                if (graphdRecord !== null && graphdRecord.port !== null) {
                    const stillReachable: boolean = await graphdHealthReachable(graphdRecord.port)
                    expect(stillReachable, 'graph-db daemon must NOT be left orphaned after vt-daemon failure').toBe(false)
                    if (graphdRecord.pid) {
                        const exited: boolean = await waitForDaemonExit(graphdRecord.pid, DAEMON_SHUTDOWN_TIMEOUT_MS)
                        expect(exited, 'orphaned graph-db pid must have exited').toBe(true)
                    }
                }
            },
            SCENARIO_TIMEOUT_MS,
        )
    },
)
