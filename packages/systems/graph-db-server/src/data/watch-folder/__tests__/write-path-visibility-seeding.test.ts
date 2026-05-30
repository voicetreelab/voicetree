/**
 * Write-path folder-visibility seeding contract.
 *
 * On setWriteFolderPath(writeFolderPath), the active-view folder-visibility table should
 * be seeded with exactly the writeFolderPath as 'expanded'. Immediate child
 * directories of writeFolderPath must NOT be auto-seeded — they default to
 * collapsed and only become expanded when the user clicks or when the file
 * watcher observes them appear under an already-expanded parent.
 *
 * This contract matches the team's design stance (see Bug 2 in
 * toggle-behavior.test.ts: 'starred folders should NOT auto-load on new
 * folder creation'): visible in the sidebar ≠ pre-expanded.
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
} from '../../../state/watch-folder-store'
import { saveProjectConfigForDirectory } from '@vt/app-config/project-config'
import { markActiveViewFolderHidden } from '../folder-visibility-active-view'
import { setWriteFolderPath, getReadPaths } from '../../../state/projectAllowlist'
import { saveSettings, clearSettingsCache } from '@vt/app-config/settings'
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings'
import { getFolderStateForActiveView } from '../../views/folderStateOps'

describe('write path folder visibility seeding', () => {
    let testTmpDir: string
    let voicetreeHomeDir: string

    beforeEach(async () => {
        testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-path-visibility-'))
        voicetreeHomeDir = path.join(testTmpDir, 'voicetree-home')
        await fs.mkdir(voicetreeHomeDir, { recursive: true })

        process.env.VOICETREE_HOME_PATH = voicetreeHomeDir
        initGraphModel({
            syncProjectState: vi.fn(),
            syncFolderTree: vi.fn(),
            syncStarredFolderTrees: vi.fn(),
            syncExternalFolderTrees: vi.fn(),
            fitViewport: vi.fn(),
        })

        setGraph(createEmptyGraph())
        clearWatchFolderState()
        clearSettingsCache()
        await saveSettings({ ...DEFAULT_SETTINGS, starredFolders: [] })
    })

    afterEach(async () => {
        await fs.rm(testTmpDir, { recursive: true, force: true })
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        vi.clearAllMocks()
    })

    it('setWriteFolderPath seeds only the write path as expanded (children remain collapsed by default)', async () => {
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'voicetree')
        const childA = path.join(writeFolderPath, '2025-09-30')
        const childB = path.join(writeFolderPath, 'notes')
        const nested = path.join(childA, 'deep')
        await fs.mkdir(nested, { recursive: true })
        await fs.mkdir(childB, { recursive: true })
        setProjectRoot(watchedDir)
        await saveProjectConfigForDirectory(watchedDir, { writeFolderPath })

        const result = await setWriteFolderPath(writeFolderPath, { createStarterIfEmpty: false })

        expect(result.success).toBe(true)
        const expandedPaths = await getReadPaths()
        expect([...expandedPaths].sort()).toEqual([writeFolderPath])
        expect(expandedPaths).not.toContain(childA)
        expect(expandedPaths).not.toContain(childB)
        expect(expandedPaths).not.toContain(nested)
    })

    it('setWriteFolderPath seeds only the write path; existing child visibility rows are preserved', async () => {
        const watchedDir = path.join(testTmpDir, 'project')
        const writeFolderPath = path.join(watchedDir, 'voicetree')
        const hiddenChild = path.join(writeFolderPath, 'private')
        const newChild = path.join(writeFolderPath, 'public')
        await fs.mkdir(hiddenChild, { recursive: true })
        await fs.mkdir(newChild, { recursive: true })
        setProjectRoot(watchedDir)
        await saveProjectConfigForDirectory(watchedDir, { writeFolderPath })
        await markActiveViewFolderHidden(watchedDir, hiddenChild)

        const result = await setWriteFolderPath(writeFolderPath, { createStarterIfEmpty: false })

        expect(result.success).toBe(true)
        const expandedPaths = await getReadPaths()
        expect([...expandedPaths].sort()).toEqual([writeFolderPath])
        // The explicit 'hidden' user state for hiddenChild is preserved.
        expect(getFolderStateForActiveView(watchedDir).folderState).toContainEqual([
            hiddenChild,
            'hidden',
        ])
        // newChild has no row at all — it defaults collapsed.
        const folderStatePaths = getFolderStateForActiveView(watchedDir).folderState.map(
            ([p]) => p,
        )
        expect(folderStatePaths).not.toContain(newChild)
    })
})
