/**
 * BF-242 — chokidar watcher rebuild on folder-visibility mutations and view switches.
 *
 * Decision 4: full close + re-watch on every state-affecting change. No coalescing.
 *
 * These tests verify the event wiring that drives the rebuild. The full close+rewatch
 * integration (daemon-bound) is covered by the Phase 1 gate smoke test.
 */

import { vi, describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
    openFolderVisibilityDb,
    closeFolderVisibilityDb,
    type FolderVisibilityDatabase,
} from '../../src/sqlite/folderVisibilitySqlite'
import { ensureDefaultView } from '../../src/sqlite/viewsRepository'
import { emitViewSwitched, onViewSwitched } from '../../src/state/viewsStore'
import {
    configureFolderVisibilityStore,
    clearFolderVisibilityStoreForTests,
    setFolderState,
    setFolderStateBatch,
    onFolderStateChanged,
    deriveWatchRoots,
} from '@vt/graph-state'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpVaults: string[] = []
const openDbs: FolderVisibilityDatabase[] = []

function makeVault(): string {
    const v = fs.mkdtempSync(path.join(os.tmpdir(), 'bf242-rebuild-test-'))
    tmpVaults.push(v)
    return v
}

function openTestDb(vault: string): FolderVisibilityDatabase {
    const db = openFolderVisibilityDb(vault)
    openDbs.push(db)
    return db
}

afterEach(() => {
    vi.restoreAllMocks()
    clearFolderVisibilityStoreForTests()
    while (openDbs.length) closeFolderVisibilityDb(openDbs.pop()!)
    while (tmpVaults.length) {
        fs.rmSync(tmpVaults.pop()!, { recursive: true, force: true })
    }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('watchFolder rebuild (BF-242)', () => {
    it('Mutation triggers rebuild: setFolderState fires onFolderStateChanged listener', () => {
        const db = openTestDb(makeVault())
        ensureDefaultView(db)
        configureFolderVisibilityStore(db)

        const listener = vi.fn()
        const unsub = onFolderStateChanged(listener)
        try {
            setFolderState('main', path.join(os.tmpdir(), 'notes') as string & { __brand: 'AbsolutePath' }, 'expanded')
            expect(listener).toHaveBeenCalledOnce()
        } finally {
            unsub()
        }
    })

    it('Nested expansion does NOT add a watcher mount: deriveWatchRoots returns only topmost', () => {
        const map = new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
            ['/notes', 'expanded'],
            ['/notes/work', 'expanded'],
        ])
        const roots = deriveWatchRoots(map)
        expect([...roots]).toEqual(['/notes'])
        expect(roots.has('/notes/work')).toBe(false)
    })

    it('View switch triggers rebuild: emitViewSwitched fires onViewSwitched listener', () => {
        const listener = vi.fn()
        const unsub = onViewSwitched(listener)
        try {
            emitViewSwitched({ type: 'view-switched', previousViewId: 'main', activeViewId: 'work' })
            expect(listener).toHaveBeenCalledOnce()
            expect(listener).toHaveBeenCalledWith({
                type: 'view-switched',
                previousViewId: 'main',
                activeViewId: 'work',
            })
        } finally {
            unsub()
        }
    })

    it('Batch mutation = single rebuild: setFolderStateBatch emits exactly one event', () => {
        const db = openTestDb(makeVault())
        ensureDefaultView(db)
        configureFolderVisibilityStore(db)

        const listener = vi.fn()
        const unsub = onFolderStateChanged(listener)
        try {
            const base = path.join(os.tmpdir(), 'bf242') as string & { __brand: 'AbsolutePath' }
            setFolderStateBatch('main', [
                { path: `${base}/notes` as typeof base, state: 'expanded' },
                { path: `${base}/work` as typeof base, state: 'expanded' },
                { path: `${base}/archive` as typeof base, state: 'collapsed' },
            ])
            // Three updates in one batch must fire exactly ONE event (not three)
            expect(listener).toHaveBeenCalledTimes(1)
        } finally {
            unsub()
        }
    })
})
