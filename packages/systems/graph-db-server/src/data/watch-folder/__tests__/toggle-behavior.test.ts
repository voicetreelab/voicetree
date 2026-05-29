/**
 * TDD Red Phase: File tree toggle behavior bugs.
 *
 * Bug 1: removeReadPath fires broadcastVaultState as void (fire-and-forget),
 *         so vault state + folder tree broadcasts may not have completed
 *         by the time the caller acts on the return value.
 *
 * Bug 2: createDatedVoiceTreeFolder auto-loads ALL starred folders as expanded paths,
 *         even though the user only wants starred folders to appear in the sidebar
 *         without being loaded unless they were previously loaded.
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
    loadVaultPathAdditively: vi.fn().mockResolvedValue({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] },
    }),
    resolveLinkedNodesInWatchedFolder: vi.fn().mockResolvedValue([]),
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
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { setActiveViewFolderState } from '../folder-visibility-active-view'
import {
    removeReadPath,
    addReadPath,
    setWriteFolder,
    getReadPaths,
    getVaultPaths,
    createDatedVoiceTreeFolder,
} from '../../../state/vaultAllowlist'
import { saveSettings, clearSettingsCache } from '@vt/app-config/settings'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'

// ── Bug 1: removeReadPath toggle — broadcast must complete before return ─

describe('Bug 1: removeReadPath should complete vault state broadcast before returning', () => {
    let testTmpDir: string
    let appSupportDir: string
    let syncVaultStateSpy: ReturnType<typeof vi.fn>
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-bug1-'))
        appSupportDir = path.join(testTmpDir, 'app-support')
        await fs.mkdir(appSupportDir, { recursive: true })

        syncVaultStateSpy = vi.fn()
        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = appSupportDir
        initGraphModel({
            syncVaultState: syncVaultStateSpy,
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

    it('syncVaultState callback should fire with updated vault paths before removeReadPath resolves', async () => {
        // GIVEN: A project with writeFolder and one expanded path loaded
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath is called to unload readA
        const result = await removeReadPath(readPathA)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called (broadcast completed, not still pending)
        // If broadcastVaultState is fire-and-forget (void), this will FAIL
        // because the async broadcast chain hasn't resolved yet.
        expect(syncVaultStateSpy).toHaveBeenCalled()

        // AND: The broadcast payload should NOT include the removed path
        const lastCall = syncVaultStateSpy.mock.calls[syncVaultStateSpy.mock.calls.length - 1]
        const broadcastData = lastCall[0] as { vaultPaths: readonly string[] }
        expect(broadcastData.vaultPaths).not.toContain(readPathA)
    })

    it('folder tree should be rebuilt before removeReadPath resolves', async () => {
        // GIVEN: A project with a loaded expanded path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath unloads readA
        await removeReadPath(readPathA)

        // THEN: syncFolderTree should have been called (folder tree rebuilt)
        // broadcastFolderTreeImmediate is called inside broadcastVaultState,
        // which is fire-and-forget — so this FAILS if the broadcast hasn't completed.
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('vault paths should not include removed path after removal', async () => {
        // GIVEN: A project with two expanded paths
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        const readPathB = path.join(watchedDir, 'readB')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        await fs.mkdir(readPathB, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')
        await setActiveViewFolderState(watchedDir, readPathB, 'expanded')

        // WHEN: removeReadPath removes readPathA
        await removeReadPath(readPathA)

        // THEN: getVaultPaths should not include readPathA
        const paths = await getVaultPaths()
        expect(paths).not.toContain(readPathA)
        expect(paths).toContain(readPathB)
    })
})

// ── Bug 1 additional: addReadPath and setWriteFolder broadcast timing ──────

describe('Bug 1 additional: addReadPath and setWriteFolder should also complete broadcast before returning', () => {
    let testTmpDir: string
    let appSupportDir: string
    let syncVaultStateSpy: ReturnType<typeof vi.fn>
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-bug1-extra-'))
        appSupportDir = path.join(testTmpDir, 'app-support')
        await fs.mkdir(appSupportDir, { recursive: true })

        syncVaultStateSpy = vi.fn()
        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = appSupportDir
        initGraphModel({
            syncVaultState: syncVaultStateSpy,
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

    it('addReadPath should complete vault state broadcast before returning', async () => {
        // GIVEN: A project with a write path and no expanded paths
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'write')
        const newReadPath = path.join(watchedDir, 'newRead')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(newReadPath, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })

        // WHEN: addReadPath is called
        const result = await addReadPath(newReadPath)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called before addReadPath returned
        expect(syncVaultStateSpy).toHaveBeenCalled()

        // AND: syncFolderTree should have been called (folder tree rebuilt)
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('setWriteFolder should complete vault state broadcast before returning', async () => {
        // GIVEN: A project with a write path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'write')
        const newWriteFolder = path.join(watchedDir, 'newWrite')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(newWriteFolder, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })

        // WHEN: setWriteFolder is called
        const result = await setWriteFolder(newWriteFolder)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called before setWriteFolder returned
        expect(syncVaultStateSpy).toHaveBeenCalled()

        // AND: syncFolderTree should have been called (folder tree rebuilt)
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })
})

// ── Bug 1 payload: folder tree should reflect correct loadState ──────────

describe('Bug 1 payload: folder tree broadcast should reflect updated loadState', () => {
    let testTmpDir: string
    let appSupportDir: string
    let syncFolderTreeSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-payload-'))
        appSupportDir = path.join(testTmpDir, 'app-support')
        await fs.mkdir(appSupportDir, { recursive: true })

        syncFolderTreeSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = appSupportDir
        initGraphModel({
            syncVaultState: vi.fn(),
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
        const writeFolder = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })
        await setActiveViewFolderState(watchedDir, readPathA, 'expanded')

        // WHEN: removeReadPath unloads readA
        await removeReadPath(readPathA)

        // THEN: The folder tree broadcast should have been called
        expect(syncFolderTreeSpy).toHaveBeenCalled()

        // AND: The loadedPaths set used internally should NOT include readPathA
        // We verify this indirectly: getVaultPaths (used by doBroadcast) should not include it
        const paths = await getVaultPaths()
        expect(paths).not.toContain(readPathA)
    })
})

// ── Bug 2: starred folders should NOT auto-load on new folder creation ──

describe('Bug 2: createDatedVoiceTreeFolder should not auto-load starred folders', () => {
    let testTmpDir: string
    let appSupportDir: string
    let syncVaultStateSpy: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toggle-bug2-'))
        appSupportDir = path.join(testTmpDir, 'app-support')
        await fs.mkdir(appSupportDir, { recursive: true })

        syncVaultStateSpy = vi.fn()

        process.env.VOICETREE_HOME_PATH = appSupportDir
        initGraphModel({
            syncVaultState: syncVaultStateSpy,
            syncFolderTree: vi.fn(),
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
    })

    afterEach(async () => {
        await fs.rm(testTmpDir, { recursive: true, force: true })
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        vi.clearAllMocks()
    })

    it('starred folders NOT previously loaded should NOT be added to expanded paths', async () => {
        // GIVEN: A project with a write path and no expanded paths
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'currentWrite')
        await fs.mkdir(writeFolder, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })

        // AND: A starred folder that is NOT currently expanded
        const starredFolder = path.join(testTmpDir, 'starred-vault')
        await fs.mkdir(starredFolder, { recursive: true })
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [starredFolder] })

        // WHEN: User creates a new dated folder
        const result = await createDatedVoiceTreeFolder()
        expect(result.success).toBe(true)

        // THEN: The starred folder should NOT be expanded.
        const expandedPaths = await getReadPaths()
        expect(expandedPaths).not.toContain(starredFolder)
    })

    it('starred folders should NOT appear in getVaultPaths after new folder creation (unless previously loaded)', async () => {
        // GIVEN: A project with a write path
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'currentWrite')
        await fs.mkdir(writeFolder, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })

        // AND: Two starred folders, neither currently loaded
        const starredA = path.join(testTmpDir, 'starred-a')
        const starredB = path.join(testTmpDir, 'starred-b')
        await fs.mkdir(starredA, { recursive: true })
        await fs.mkdir(starredB, { recursive: true })
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [starredA, starredB] })

        // WHEN: createDatedVoiceTreeFolder is called
        const result = await createDatedVoiceTreeFolder()
        expect(result.success).toBe(true)

        // THEN: Neither starred folder should be in the vault paths
        const allPaths = await getVaultPaths()
        expect(allPaths).not.toContain(starredA)
        expect(allPaths).not.toContain(starredB)
    })

    it('a previously-loaded starred folder should remain loaded after new folder creation', async () => {
        // GIVEN: A project where a starred folder IS already expanded
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolder = path.join(watchedDir, 'currentWrite')
        const starredAndLoaded = path.join(testTmpDir, 'starred-loaded')
        await fs.mkdir(writeFolder, { recursive: true })
        await fs.mkdir(starredAndLoaded, { recursive: true })
        setProjectRoot(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder,
        })
        await setActiveViewFolderState(watchedDir, starredAndLoaded, 'expanded')

        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [starredAndLoaded] })

        // WHEN: createDatedVoiceTreeFolder is called
        const result = await createDatedVoiceTreeFolder()
        expect(result.success).toBe(true)

        // THEN: The previously-loaded starred folder should still be expanded
        // (Loading state should be preserved — only the auto-loading of
        // not-previously-loaded starred folders is the bug.)
        const expandedPaths = await getReadPaths()
        expect(expandedPaths).toContain(starredAndLoaded)
    })
})

// The 'write path folder visibility seeding' describe lives in
// ./write-path-visibility-seeding.test.ts (extracted to keep this file under the
// 500-line file-size cap).
