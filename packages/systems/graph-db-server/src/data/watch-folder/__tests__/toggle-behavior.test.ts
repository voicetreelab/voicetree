/**
 * TDD Red Phase: File tree toggle behavior bugs.
 *
 * Bug 1: removeReadPath fires broadcastProjectState as void (fire-and-forget),
 *         so project state + folder tree broadcasts may not have completed
 *         by the time the caller acts on the return value.
 *
 * These tests represent the DESIRED behavior and should FAIL (red) against
 * the current implementation.
 */

/* vt-allow-direct-daemon-mutation-import: graph-model owns these primitives; this file tests them directly */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// ── Mocks (hoisted before imports) ──────────────────────────────────────

vi.mock('../../graph/loading/loadGraphFromDisk', () => ({
    loadProjectPathAdditively: vi.fn().mockResolvedValue({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] },
    }),
    resolveAbsoluteLinkedNodes: vi.fn().mockResolvedValue([]),
}))

vi.mock('./create-starter-node', () => ({
    createStarterNode: vi.fn().mockResolvedValue({ nodes: {} }),
}))

vi.mock('../../graph/mutations/applyGraphDelta', () => ({
    applyGraphDeltaToMemState: vi.fn().mockResolvedValue([]),
    refreshGraphChangeSideEffects: vi.fn(),
}))

vi.mock('../../graph/loading/notifyTextToTreeServer', () => ({
    notifyTextToTreeServerOfDirectory: vi.fn(),
}))

vi.mock('./folder-scanner', () => ({
    getDirectoryTree: vi.fn().mockResolvedValue({
        name: 'root',
        path: '/tmp',
        children: [],
        isDirectory: true,
    }),
}))

// ── Imports (after mocks) ───────────────────────────────────────────────

import { initGraphModel } from '@vt/graph-model'
import { setGraph } from '../../../state/graph-store'
import { createEmptyGraph } from '@vt/graph-model/graph'
import {
    setProjectRoot,
    clearWatchFolderState,
    setWatcher,
} from '../../../state/watch-folder-store'
import { saveProjectConfigForDirectory } from '@vt/app-config/project-config'
import { setActiveViewFolderState } from '../folder-visibility-active-view'
import {
    removeReadPath,
    addReadPath,
    setWriteFolderPath,
    getProjectPaths,
} from '../../../state/projectAllowlist'
import { saveSettings, clearSettingsCache } from '@vt/app-config/settings'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'

// ── Bug 1: removeReadPath toggle — broadcast must complete before return ─

describe('Bug 1: removeReadPath should complete project state broadcast before returning', () => {
    let testTmpDir: string
    let voicetreeHomeDir: string
    let syncProjectStateSpy: ReturnType<typeof vi.fn>
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-bug1-'))
        voicetreeHomeDir = path.join(testTmpDir, 'voicetree-home')
        await fs.mkdir(voicetreeHomeDir, { recursive: true })

        syncProjectStateSpy = vi.fn()
        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = voicetreeHomeDir
        initGraphModel({
            syncProjectState: syncProjectStateSpy,
            syncFolderTree: syncFolderTreeSpy,
            syncStarredFolderTrees: vi.fn(),
            syncExternalFolderTrees: vi.fn(),
            fitViewport: vi.fn(),
        })

        setGraph(createEmptyGraph())
        clearWatchFolderState()
        setWatcher({
            add: vi.fn(),
            unwatch: vi.fn(),
        } as never)
        clearSettingsCache()

        // Write default settings so getStarredFolders doesn't fail
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [] })
    })

    afterEach(async () => {
        await fs.rm(testTmpDir, { recursive: true, force: true })
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        vi.clearAllMocks()
    })

    it('syncProjectState callback should fire with updated project paths before removeReadPath resolves', async () => {
        // GIVEN: A project with writeFolderPath and one expanded path loaded
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath is called to unload readA
        const result = await removeReadPath(readPathA)
        expect(result.success).toBe(true)

        // THEN: syncProjectState should have been called (broadcast completed, not still pending)
        // If broadcastProjectState is fire-and-forget (void), this will FAIL
        // because the async broadcast chain hasn't resolved yet.
        expect(syncProjectStateSpy).toHaveBeenCalled()

        // AND: the broadcast's observable effect — the project paths read back
        // through the public API — should NOT include the removed path.
        expect(await getProjectPaths()).not.toContain(readPathA)
    })

    it('folder tree should be rebuilt before removeReadPath resolves', async () => {
        // GIVEN: A project with a loaded expanded path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath unloads readA
        await removeReadPath(readPathA)

        // THEN: syncFolderTree should have been called (folder tree rebuilt)
        // broadcastFolderTreeImmediate is called inside broadcastProjectState,
        // which is fire-and-forget — so this FAILS if the broadcast hasn't completed.
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('project paths should not include removed path after removal', async () => {
        // GIVEN: A project with two expanded paths
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        const readPathB = path.join(watchedDir, 'readB')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        await fs.mkdir(readPathB, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')
        await setActiveViewFolderState(watchedDir, readPathB, 'expanded')

        // WHEN: removeReadPath removes readPathA
        await removeReadPath(readPathA)

        // THEN: getProjectPaths should not include readPathA
        const paths = await getProjectPaths()
        expect(paths).not.toContain(readPathA)
        expect(paths).toContain(readPathB)
    })
})

// ── Bug 1 additional: addReadPath and setWriteFolderPath broadcast timing ──────

describe('Bug 1 additional: addReadPath and setWriteFolderPath should also complete broadcast before returning', () => {
    let testTmpDir: string
    let voicetreeHomeDir: string
    let syncProjectStateSpy: ReturnType<typeof vi.fn>
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-bug1-extra-'))
        voicetreeHomeDir = path.join(testTmpDir, 'voicetree-home')
        await fs.mkdir(voicetreeHomeDir, { recursive: true })

        syncProjectStateSpy = vi.fn()
        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = voicetreeHomeDir
        initGraphModel({
            syncProjectState: syncProjectStateSpy,
            syncFolderTree: syncFolderTreeSpy,
            syncStarredFolderTrees: vi.fn(),
            syncExternalFolderTrees: vi.fn(),
            fitViewport: vi.fn(),
        })

        setGraph(createEmptyGraph())
        clearWatchFolderState()
        setWatcher({
            add: vi.fn(),
            unwatch: vi.fn(),
        } as never)
        clearSettingsCache()
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [] })
    })

    afterEach(async () => {
        await fs.rm(testTmpDir, { recursive: true, force: true })
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        vi.clearAllMocks()
    })

    it('addReadPath should complete project state broadcast before returning', async () => {
        // GIVEN: A project with a write path and no expanded paths
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const newReadPath = path.join(watchedDir, 'newRead')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(newReadPath, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })

        // WHEN: addReadPath is called
        const result = await addReadPath(newReadPath)
        expect(result.success).toBe(true)

        // THEN: syncProjectState should have been called before addReadPath returned
        expect(syncProjectStateSpy).toHaveBeenCalled()

        // AND: syncFolderTree should have been called (folder tree rebuilt)
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('setWriteFolderPath should complete project state broadcast before returning', async () => {
        // GIVEN: A project with a write path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const newWriteFolderPath = path.join(watchedDir, 'newWrite')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(newWriteFolderPath, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })

        // WHEN: setWriteFolderPath is called
        const result = await setWriteFolderPath(newWriteFolderPath)
        expect(result.success).toBe(true)

        // THEN: syncProjectState should have been called before setWriteFolderPath returned
        expect(syncProjectStateSpy).toHaveBeenCalled()

        // AND: syncFolderTree should have been called (folder tree rebuilt)
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })
})

// ── Bug 1 payload: folder tree should reflect correct loadState ──────────

describe('Bug 1 payload: folder tree broadcast should reflect updated loadState', () => {
    let testTmpDir: string
    let voicetreeHomeDir: string
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-payload-'))
        voicetreeHomeDir = path.join(testTmpDir, 'voicetree-home')
        await fs.mkdir(voicetreeHomeDir, { recursive: true })

        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = voicetreeHomeDir
        initGraphModel({
            syncProjectState: vi.fn(),
            syncFolderTree: syncFolderTreeSpy,
            syncStarredFolderTrees: vi.fn(),
            syncExternalFolderTrees: vi.fn(),
            fitViewport: vi.fn(),
        })

        setGraph(createEmptyGraph())
        clearWatchFolderState()
        setWatcher({
            add: vi.fn(),
            unwatch: vi.fn(),
        } as never)
        clearSettingsCache()
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [] })
    })

    afterEach(async () => {
        await fs.rm(testTmpDir, { recursive: true, force: true })
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        vi.clearAllMocks()
    })

    it('removed expanded path should have loadState not-loaded in folder tree broadcast', async () => {
        // GIVEN: A project with a loaded expanded path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolderPath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath unloads readA
        await removeReadPath(readPathA)

        // THEN: The folder tree broadcast should have been called
        expect(syncFolderTreeSpy).toHaveBeenCalled()

        // AND: The loadedPaths set used internally should NOT include readPathA
        // We verify this indirectly: getProjectPaths (used by doBroadcast) should not include it
        const paths = await getProjectPaths()
        expect(paths).not.toContain(readPathA)
    })
})

// The 'write path folder visibility seeding' describe lives in
// ./write-path-visibility-seeding.test.ts (extracted to keep this file under the
// 500-line file-size cap).
