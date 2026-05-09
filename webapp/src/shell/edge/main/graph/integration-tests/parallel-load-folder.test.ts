/**
 * Black-box test for surface (a) — Parallel loadFolder idempotency.
 *
 * Demonstrates that 3+ concurrent loadFolder() callers (renderer bootstrap,
 * UI click, IPC handler) for the same vault path:
 *   1. spawn at most one vt-graphd daemon process for that vault, and
 *   2. leave the just-loaded graph populated (no late re-spawn clearing the
 *      graph view).
 *
 * Surfaces severity bugs #2 (folder-load races) and #1 (lock-holder retry
 * loop). The companion test in folder-loading.test.ts is currently skipped
 * for an unrelated BETA broadcast-count regression — this test isolates the
 * idempotency surface so it isn't blocked by that.
 *
 * Black-box rules: drives the public loadFolder() API, asserts on observable
 * graph state via getGraph(), and counts daemons via `ps` (no internal
 * idempotency-map inspection, no mocks of internal collaborators).
 */

import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    loadFolder,
    setVaultPath,
    stopFileWatching,
} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearDaemonClientCache } from '@/shell/edge/main/electron/graph-daemon'
import { GraphDbClient } from '@vt/graph-db-client'
import { initGraphModel } from '@vt/graph-model'
import { createGraph } from '@vt/graph-model/graph'
import type { GraphDelta } from '@vt/graph-model/graph'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { clearRecentDeltas } from '@vt/graph-db-server/state/recent-deltas-store'
import { waitForCondition } from '@/utils/test-utils/waitForCondition'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'

const MIN_SMALL_NODE_COUNT: 10 = 10 as const
const TIMEOUT_MS: 60000 = 60000 as const

vi.mock('@/shell/edge/main/state/app-electron-state', () => ({
    getMainWindow: vi.fn(() => ({
        webContents: { send: vi.fn(), isDestroyed: vi.fn(() => false) },
        isDestroyed: vi.fn(() => false),
    })),
    setMainWindow: vi.fn(),
}))

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now()),
    },
}))

let tempFixtureRoot: string | null = null
let vaultPath: string

async function copyFixture(): Promise<string> {
    if (!tempFixtureRoot) throw new Error('tempFixtureRoot not initialized')
    const dst: string = path.join(tempFixtureRoot, 'example_small')
    await fs.cp(EXAMPLE_SMALL_PATH, dst, { recursive: true })
    await Promise.all([
        fs.rm(path.join(dst, '.voicetree', 'graphd.port'), { force: true }),
        fs.rm(path.join(dst, '.voicetree', 'graphd.lock'), { force: true }),
    ])
    return dst
}

async function shutdownDaemonForVault(vault: string): Promise<void> {
    const client: GraphDbClient | null = await GraphDbClient.connect({ vault }).catch(() => null)
    await client?.shutdown().catch(() => undefined)
}

function countVtGraphdProcessesForVault(vault: string): number {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return 0
    const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
        encoding: 'utf8',
        timeout: 5000,
    })
    if (result.status !== 0 || !result.stdout) return 0
    const re: RegExp = new RegExp(`vt-graphd\\.ts.*--vault\\s+${vault}(\\s|$)`)
    return result.stdout.split('\n').filter(line => re.test(line)).length
}

describe('Parallel loadFolder idempotency (Hot Zone A surface a)', () => {
    beforeAll(async () => {
        tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'parallel-load-folder-'))
        initGraphModel(
            { appSupportPath: path.join(tempFixtureRoot, 'app-support') },
            {
                onGraphDelta: (): void => undefined,
                onGraphCleared: (): void => undefined,
                onWatchingStarted: (): void => undefined,
            },
        )
        vaultPath = await copyFixture()
        await saveVaultConfigForDirectory(vaultPath, {
            writePath: path.join(vaultPath, 'voicetree'),
        })
    }, TIMEOUT_MS)

    beforeEach(async () => {
        // Drain previous-test fire-and-forget async work.
        await new Promise(resolve => setTimeout(resolve, 200))

        const noopBroadcasts: {
            onGraphDelta: (delta: GraphDelta) => void
            onGraphCleared: () => void
            onWatchingStarted: () => void
        } = {
            onGraphDelta: (): void => undefined,
            onGraphCleared: (): void => undefined,
            onWatchingStarted: (): void => undefined,
        }
        initGraphModel(
            { appSupportPath: path.join(tempFixtureRoot!, 'app-support') },
            noopBroadcasts,
        )

        setGraph(createGraph({}))
        setVaultPath('')
        clearRecentDeltas()
        clearDaemonClientCache()
    })

    afterEach(async () => {
        await stopFileWatching()
        vi.clearAllMocks()
    })

    afterAll(async () => {
        await shutdownDaemonForVault(vaultPath)
        clearDaemonClientCache()
        if (tempFixtureRoot) {
            await fs.rm(tempFixtureRoot, { recursive: true, force: true })
            tempFixtureRoot = null
        }
    }, TIMEOUT_MS)

    it('5 concurrent loadFolder callers spawn ≤1 vt-graphd and leave graph populated', async () => {
        // GIVEN: clean slate — no stale daemon for this vault.
        await shutdownDaemonForVault(vaultPath)
        clearDaemonClientCache()

        // WHEN: 5 callers race to load the same folder.
        // (Models renderer-bootstrap + UI click + IPC handler + 2 stragglers.)
        const callers: ReadonlyArray<Promise<{ readonly success: boolean }>> = [
            loadFolder(vaultPath, { includeActiveViewExpandedPaths: false }),
            loadFolder(vaultPath, { includeActiveViewExpandedPaths: false }),
            loadFolder(vaultPath, { includeActiveViewExpandedPaths: false }),
            loadFolder(vaultPath, { includeActiveViewExpandedPaths: false }),
            loadFolder(vaultPath, { includeActiveViewExpandedPaths: false }),
        ]
        const results: ReadonlyArray<{ readonly success: boolean }> = await Promise.all(callers)

        // THEN: every caller saw success.
        results.forEach(r => expect(r.success).toBe(true))

        // AND: graph populated — not cleared by a late re-spawn.
        await waitForCondition(
            () => Object.keys(getGraph().nodes).length >= MIN_SMALL_NODE_COUNT,
            { maxWaitMs: 10_000, errorMessage: 'graph never reached MIN_SMALL_NODE_COUNT after parallel load' },
        )
        const nodeCount: number = Object.keys(getGraph().nodes).length
        expect(nodeCount).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)

        // AND: at most 1 vt-graphd process for this vault.
        if (process.platform === 'darwin' || process.platform === 'linux') {
            const daemonCount: number = countVtGraphdProcessesForVault(vaultPath)
            expect(daemonCount, `expected ≤1 vt-graphd for vault, found ${daemonCount}`)
                .toBeLessThanOrEqual(1)
        }

        // AND: a follow-up loadFolder is a no-op that preserves the graph
        // (the original race symptom: late call-site re-spawns and clears).
        const followup: { readonly success: boolean } = await loadFolder(vaultPath, {
            includeActiveViewExpandedPaths: false,
        })
        expect(followup.success).toBe(true)
        const nodeCountAfterFollowup: number = Object.keys(getGraph().nodes).length
        expect(nodeCountAfterFollowup).toBeGreaterThanOrEqual(MIN_SMALL_NODE_COUNT)
    }, TIMEOUT_MS)
})
