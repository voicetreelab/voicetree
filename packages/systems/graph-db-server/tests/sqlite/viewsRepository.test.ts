/**
 * BF-243 — views table CRUD + default-view initialization tests.
 *
 * Verifies view operations against real sqlite. Each test uses an isolated
 * tmpdir project and the BF-238 open/migrate primitives.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    closeFolderVisibilityDb,
    defaultFolderVisibilityDbDeps,
    openFolderVisibilityDb,
    type FolderVisibilityDatabase,
} from '../../src/data/views/folderVisibilitySqlite'
import {
    ActiveViewDeleteError,
    cloneView,
    createView,
    deleteView,
    ensureDefaultView,
    getActiveViewId,
    listViews,
    switchActiveView,
} from '../../src/data/views/viewsRepository'
import { createViewsStore, type ViewSwitchedEvent } from '../../src/data/views/viewsStore'

const tmpProjects: string[] = []
const openDbs: FolderVisibilityDatabase[] = []

function makeProject(): string {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'views-repository-test-'))
    tmpProjects.push(project)
    return project
}

function openTestDb(): FolderVisibilityDatabase {
    const db = openFolderVisibilityDb(makeProject(), defaultFolderVisibilityDbDeps)
    openDbs.push(db)
    return db
}

function countActiveViews(db: FolderVisibilityDatabase): number {
    return (db.prepare('SELECT COUNT(*) AS count FROM views WHERE is_active = 1').get() as { count: number }).count
}

function viewRows(db: FolderVisibilityDatabase): Array<{ view_id: string; name: string; is_active: number }> {
    return db
        .prepare('SELECT view_id, name, is_active FROM views ORDER BY name COLLATE NOCASE, view_id')
        .all() as Array<{ view_id: string; name: string; is_active: number }>
}

function visibilityRows(
    db: FolderVisibilityDatabase,
    viewId: string,
): Array<{ path: string; state: string }> {
    return db
        .prepare('SELECT path, state FROM folder_visibility WHERE view_id = ? ORDER BY path')
        .all(viewId) as Array<{ path: string; state: string }>
}

afterEach(() => {
    while (openDbs.length) {
        closeFolderVisibilityDb(openDbs.pop()!)
    }
    while (tmpProjects.length) {
        fs.rmSync(tmpProjects.pop()!, { recursive: true, force: true })
    }
})

describe('viewsRepository', () => {
    it('ensureDefaultView creates one active main view and is idempotent', () => {
        const db = openTestDb()

        ensureDefaultView(db)
        ensureDefaultView(db)

        const rows = viewRows(db)
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe('main')
        expect(rows[0].is_active).toBe(1)
        expect(rows[0].view_id).not.toBe('main')
        expect(countActiveViews(db)).toBe(1)
        expect(getActiveViewId(db)).toBe(rows[0].view_id)
    })

    it('creates, lists, and switches views with exactly one active row', () => {
        const db = openTestDb()
        ensureDefaultView(db)
        const mainViewId = getActiveViewId(db)
        const fresh = createView(db, 'fresh')

        expect(fresh.name).toBe('fresh')
        expect(fresh.viewId).not.toBe('fresh')
        expect(listViews(db)).toEqual([
            { viewId: fresh.viewId, name: 'fresh', isActive: false },
            { viewId: mainViewId, name: 'main', isActive: true },
        ])

        switchActiveView(db, fresh.viewId)

        expect(getActiveViewId(db)).toBe(fresh.viewId)
        expect(countActiveViews(db)).toBe(1)
        expect(listViews(db)).toEqual([
            { viewId: fresh.viewId, name: 'fresh', isActive: true },
            { viewId: mainViewId, name: 'main', isActive: false },
        ])
    })

    it('rolls back switchActiveView when the target view is missing', () => {
        const db = openTestDb()
        ensureDefaultView(db)
        const mainViewId = getActiveViewId(db)

        expect(() => switchActiveView(db, 'missing-view')).toThrow(/View not found/)

        expect(getActiveViewId(db)).toBe(mainViewId)
        expect(countActiveViews(db)).toBe(1)
    })

    it('cloneView copies all folder_visibility rows from the source view', () => {
        const db = openTestDb()
        ensureDefaultView(db)
        const mainViewId = getActiveViewId(db)
        db.prepare('INSERT INTO folder_visibility(view_id, path, state) VALUES (?, ?, ?)').run(
            mainViewId,
            '/tmp/example',
            'expanded',
        )
        db.prepare('INSERT INTO folder_visibility(view_id, path, state) VALUES (?, ?, ?)').run(
            mainViewId,
            '/tmp/other',
            'collapsed',
        )

        const clone = cloneView(db, mainViewId, 'fresh')

        expect(listViews(db)).toContainEqual({ viewId: clone.viewId, name: 'fresh', isActive: false })
        expect(visibilityRows(db, clone.viewId)).toEqual([
            { path: '/tmp/example', state: 'expanded' },
            { path: '/tmp/other', state: 'collapsed' },
        ])
        expect(visibilityRows(db, mainViewId)).toEqual([
            { path: '/tmp/example', state: 'expanded' },
            { path: '/tmp/other', state: 'collapsed' },
        ])
    })

    it('deleteView rejects the active view and removes inactive view rows', () => {
        const db = openTestDb()
        ensureDefaultView(db)
        const mainViewId = getActiveViewId(db)
        const fresh = createView(db, 'fresh')
        db.prepare('INSERT INTO folder_visibility(view_id, path, state) VALUES (?, ?, ?)').run(
            fresh.viewId,
            '/tmp/example',
            'expanded',
        )

        expect(() => deleteView(db, mainViewId)).toThrow(ActiveViewDeleteError)
        expect(() => deleteView(db, mainViewId)).toThrow(/active view/)

        deleteView(db, fresh.viewId)

        expect(listViews(db)).toEqual([{ viewId: mainViewId, name: 'main', isActive: true }])
        expect(visibilityRows(db, fresh.viewId)).toEqual([])
    })

    it('viewsStore emits view-switched when the active view changes', () => {
        const db = openTestDb()
        const store = createViewsStore(db)
        store.ensureDefaultView()
        const mainViewId = store.getActiveViewId()
        const fresh = store.createView('fresh')
        const events: ViewSwitchedEvent[] = []
        const unsubscribe = store.on('view-switched', (event) => {
            events.push(event)
        })

        store.switchActiveView(fresh.viewId)
        unsubscribe()
        store.switchActiveView(mainViewId)

        expect(events).toEqual([
            {
                type: 'view-switched',
                previousViewId: mainViewId,
                activeViewId: fresh.viewId,
            },
        ])
    })
})
