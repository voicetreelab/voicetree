/**
 * TDD Red Phase: File tree toggle behavior bugs.
 *
 * Bug 1: removeReadPath fires broadcastVaultState as void (fire-and-forget),
 *         so vault state + folder tree broadcasts may not have completed
 *         by the time the caller acts on the return value.
 *
 * Bug 2: createDatedVoiceTreeFolder auto-loads ALL starred folders as readPaths,
 *         even though the user only wants starred folders to appear in the sidebar
 *         without being loaded unless they were previously loaded.
 *
 * These tests represent the DESIRED behavior and should FAIL (red) against
 * the current implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

// ── Mocks (hoisted before imports) ──────────────────────────────────────

vi.mock('../graph/loadGraphFromDisk', () => ({
    loadVaultPathAdditively: vi.fn().mockResolvedValue({
        _tag: 'Right',
        right: { graph: { nodes: {} }, delta: [] },
    }),
    resolveLinkedNodesInWatchedFolder: vi.fn().mockResolvedValue([]),
}))

vi.mock('./create-starter-node', () => ({
    createStarterNode: vi.fn().mockResolvedValue({ nodes: {} }),
}))

vi.mock('../graph/applyGraphDelta', () => ({
    applyGraphDeltaToMemState: vi.fn().mockResolvedValue([]),
    broadcastGraphDeltaToUI: vi.fn(),
}))

vi.mock('../graph/notifyTextToTreeServer', () => ({
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

import { initGraphModel } from '../types'
import { setGraph } from '../state/graph-store'
import { createEmptyGraph } from '../pure/graph/createGraph'
import {
    setProjectRootWatchedDirectory,
    clearWatchFolderState,
    setWatcher,
} from '../state/watch-folder-store'
import { saveVaultConfigForDirectory } from './voicetree-config-io'
import {
    removeReadPath,
    addReadPath,
    setWritePath,
    getReadPaths,
    getVaultPaths,
    createDatedVoiceTreeFolder,
} from './vault-allowlist'
import { saveSettings, clearSettingsCache } from '../settings/settings_IO'
import { DEFAULT_SETTINGS } from '../pure/settings'

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

        initGraphModel(
            { appSupportPath: appSupportDir },
            {
                syncVaultState: syncVaultStateSpy,
                syncFolderTree: syncFolderTreeSpy,
                syncStarredFolderTrees: vi.fn(),
                syncExternalFolderTrees: vi.fn(),
                fitViewport: vi.fn(),
            },
        )

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

    it('syncVaultState callback should fire with updated readPaths before removeReadPath resolves', async () => {
        // GIVEN: A project with writePath and one readPath loaded
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [readPathA],
        })

        // WHEN: removeReadPath is called to unload readA
        const result = await removeReadPath(readPathA)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called (broadcast completed, not still pending)
        // If broadcastVaultState is fire-and-forget (void), this will FAIL
        // because the async broadcast chain hasn't resolved yet.
        expect(syncVaultStateSpy).toHaveBeenCalled()

        // AND: The broadcast payload should NOT include the removed path
        const lastCall = syncVaultStateSpy.mock.calls[syncVaultStateSpy.mock.calls.length - 1]
        const broadcastData = lastCall[0] as { readPaths: readonly string[] }
        expect(broadcastData.readPaths).not.toContain(readPathA)
    })

    it('folder tree should be rebuilt before removeReadPath resolves', async () => {
        // GIVEN: A project with a loaded readPath
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [readPathA],
        })

        // WHEN: removeReadPath unloads readA
        await removeReadPath(readPathA)

        // THEN: syncFolderTree should have been called (folder tree rebuilt)
        // broadcastFolderTreeImmediate is called inside broadcastVaultState,
        // which is fire-and-forget — so this FAILS if the broadcast hasn't completed.
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('readPaths from getVaultPaths should not include removed path after removal', async () => {
        // GIVEN: A project with two readPaths
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        const readPathB = path.join(watchedDir, 'readB')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        await fs.mkdir(readPathB, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [readPathA, readPathB],
        })

        // WHEN: removeReadPath removes readPathA
        await removeReadPath(readPathA)

        // THEN: getVaultPaths should not include readPathA
        const paths = await getVaultPaths()
        expect(paths).not.toContain(readPathA)
        expect(paths).toContain(readPathB)
    })
})

// ── Bug 1 additional: addReadPath and setWritePath broadcast timing ──────

describe('Bug 1 additional: addReadPath and setWritePath should also complete broadcast before returning', () => {
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

        initGraphModel(
            { appSupportPath: appSupportDir },
            {
                syncVaultState: syncVaultStateSpy,
                syncFolderTree: syncFolderTreeSpy,
                syncStarredFolderTrees: vi.fn(),
                syncExternalFolderTrees: vi.fn(),
                fitViewport: vi.fn(),
            },
        )

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
        // GIVEN: A project with a write path and no readPaths
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const newReadPath = path.join(watchedDir, 'newRead')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(newReadPath, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [],
        })

        // WHEN: addReadPath is called
        const result = await addReadPath(newReadPath)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called before addReadPath returned
        expect(syncVaultStateSpy).toHaveBeenCalled()

        // AND: syncFolderTree should have been called (folder tree rebuilt)
        expect(syncFolderTreeSpy).toHaveBeenCalled()
    })

    it('setWritePath should complete vault state broadcast before returning', async () => {
        // GIVEN: A project with a write path
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const newWritePath = path.join(watchedDir, 'newWrite')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(newWritePath, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [],
        })

        // WHEN: setWritePath is called
        const result = await setWritePath(newWritePath)
        expect(result.success).toBe(true)

        // THEN: syncVaultState should have been called before setWritePath returned
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

        initGraphModel(
            { appSupportPath: appSupportDir },
            {
                syncVaultState: vi.fn(),
                syncFolderTree: syncFolderTreeSpy,
                syncStarredFolderTrees: vi.fn(),
                syncExternalFolderTrees: vi.fn(),
                fitViewport: vi.fn(),
            },
        )

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

    it('removed readPath should have loadState not-loaded in folder tree broadcast', async () => {
        // GIVEN: A project with a loaded readPath
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'write')
        const readPathA = path.join(watchedDir, 'readA')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(readPathA, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [readPathA],
        })

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

        initGraphModel(
            { appSupportPath: appSupportDir },
            {
                syncVaultState: syncVaultStateSpy,
                syncFolderTree: vi.fn(),
                syncStarredFolderTrees: vi.fn(),
                syncExternalFolderTrees: vi.fn(),
                fitViewport: vi.fn(),
            },
        )

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

    it('starred folders NOT previously loaded should NOT be added to readPaths', async () => {
        // GIVEN: A project with a write path and no readPaths
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'currentWrite')
        await fs.mkdir(writePath, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [],
        })

        // AND: A starred folder that is NOT currently in readPaths
        const starredFolder = path.join(testTmpDir, 'starred-vault')
        await fs.mkdir(starredFolder, { recursive: true })
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [starredFolder] })

        // WHEN: User creates a new dated folder
        const result = await createDatedVoiceTreeFolder()
        expect(result.success).toBe(true)

        // THEN: The starred folder should NOT be in readPaths
        // It should appear in the starred sidebar, but not be loaded as a readPath.
        // Current code FAILS here because createDatedVoiceTreeFolder does:
        //   const starred = await getStarredFolders();
        //   for (const p of starred) await addReadPath(p);
        const readPaths = await getReadPaths()
        expect(readPaths).not.toContain(starredFolder)
    })

    it('starred folders should NOT appear in getVaultPaths after new folder creation (unless previously loaded)', async () => {
        // GIVEN: A project with a write path
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'currentWrite')
        await fs.mkdir(writePath, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [],
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
        // GIVEN: A project where a starred folder IS already loaded as a readPath
        const watchedDir = path.join(testTmpDir, 'project')
        const writePath = path.join(watchedDir, 'currentWrite')
        const starredAndLoaded = path.join(testTmpDir, 'starred-loaded')
        await fs.mkdir(writePath, { recursive: true })
        await fs.mkdir(starredAndLoaded, { recursive: true })
        setProjectRootWatchedDirectory(watchedDir)

        await saveVaultConfigForDirectory(watchedDir, {
            writePath,
            readPaths: [starredAndLoaded], // Already loaded before folder creation
        })

        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [starredAndLoaded] })

        // WHEN: createDatedVoiceTreeFolder is called
        const result = await createDatedVoiceTreeFolder()
        expect(result.success).toBe(true)

        // THEN: The previously-loaded starred folder should still be in readPaths
        // (Loading state should be preserved — only the auto-loading of
        // not-previously-loaded starred folders is the bug.)
        const readPaths = await getReadPaths()
        expect(readPaths).toContain(starredAndLoaded)
    })
})
