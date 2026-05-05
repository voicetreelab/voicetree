import Database from 'better-sqlite3'
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest'

import { emptyState } from '../../src/emptyState'
import { applySetFolderState } from '../../src/apply/folderVisibility'
import {
    clearFolderVisibilityStoreForTests,
    configureFolderVisibilityStore,
    effective,
    getFolderVisibility,
    own,
    setFolderState,
    setFolderStateBatch,
    type FolderVisibilityDatabase,
} from '../../src/state/folderVisibilityStore'
import type { FolderState } from '../../src/state/folderVisibility/types'

let db: Database.Database

beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
        CREATE TABLE folder_visibility (
            view_id TEXT NOT NULL,
            path    TEXT NOT NULL,
            state   TEXT NOT NULL CHECK (state IN ('expanded','collapsed','hidden')),
            PRIMARY KEY (view_id, path)
        );
        CREATE TABLE views (
            view_id   TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_fv_view ON folder_visibility(view_id);
    `)
    configureFolderVisibilityStore(db as FolderVisibilityDatabase)
})

afterEach(() => {
    clearFolderVisibilityStoreForTests()
    db.close()
})

describe('folderVisibilityStore sqlite setters', () => {
    it('expanding a folder writes one row only', () => {
        setFolderState('main', '/tmp/example', 'expanded')

        expect(rawRows()).toEqual([
            { view_id: 'main', path: '/tmp/example', state: 'expanded' },
        ])
        expect(rawState('main', '/tmp/example/child')).toBeUndefined()
    })

    it('collapse cycle is non-destructive', () => {
        setFolderState('main', '/tmp/example', 'expanded')
        setFolderState('main', '/tmp/example/child', 'expanded')

        setFolderState('main', '/tmp/example', 'collapsed')
        setFolderState('main', '/tmp/example', 'expanded')

        expect(rawState('main', '/tmp/example')).toBe('expanded')
        expect(rawState('main', '/tmp/example/child')).toBe('expanded')
        expect(own('main', '/tmp/example/child')).toBe('expanded')
    })

    it('setter is idempotent via UPSERT', () => {
        setFolderState('main', '/tmp/example', 'expanded')
        setFolderState('main', '/tmp/example', 'collapsed')
        setFolderState('main', '/tmp/example', 'collapsed')

        expect(rawRows()).toEqual([
            { view_id: 'main', path: '/tmp/example', state: 'collapsed' },
        ])
    })

    it('batch applies in a single transaction', () => {
        expect(() => setFolderStateBatch('main', [
            { path: '/tmp/a', state: 'expanded' },
            { path: '/tmp/b', state: 'invalid' as FolderState },
        ])).toThrow()

        expect(rawRows()).toEqual([])

        setFolderStateBatch('main', [
            { path: '/tmp/a', state: 'expanded' },
            { path: '/tmp/b', state: 'collapsed' },
        ])

        expect(rawRows()).toEqual([
            { view_id: 'main', path: '/tmp/a', state: 'expanded' },
            { view_id: 'main', path: '/tmp/b', state: 'collapsed' },
        ])
    })

    it('own and effective return hidden for an unmapped folder', () => {
        expect(own('main', '/tmp/missing')).toBe('hidden')
        expect(effective('main', '/tmp/missing')).toBe('hidden')
    })

    it('reads only rows for the requested view', () => {
        setFolderState('main', '/tmp/shared', 'expanded')
        setFolderState('fresh', '/tmp/shared', 'collapsed')

        expect([...getFolderVisibility('main')]).toEqual([
            ['/tmp/shared', 'expanded'],
        ])
        expect([...getFolderVisibility('fresh')]).toEqual([
            ['/tmp/shared', 'collapsed'],
        ])
    })

    it('applySetFolderState writes through the store and bumps revision', () => {
        const initial = emptyState()

        const next = applySetFolderState(initial, {
            type: 'SetFolderState',
            viewId: 'main',
            path: '/tmp/example',
            state: 'expanded',
        })

        expect(next.meta.revision).toBe(initial.meta.revision + 1)
        expect(rawRows()).toEqual([
            { view_id: 'main', path: '/tmp/example', state: 'expanded' },
        ])
    })
})

function rawRows(): Array<{ view_id: string; path: string; state: FolderState }> {
    return db.prepare(`
        SELECT view_id, path, state
        FROM folder_visibility
        ORDER BY view_id ASC, path ASC
    `).all() as Array<{ view_id: string; path: string; state: FolderState }>
}

function rawState(viewId: string, path: string): FolderState | undefined {
    const row = db.prepare(`
        SELECT state
        FROM folder_visibility
        WHERE view_id = ? AND path = ?
    `).get(viewId, path) as { state: FolderState } | undefined
    return row?.state
}
