import { randomUUID } from 'node:crypto'
import {
    closeFolderVisibilityDb,
    defaultFolderVisibilityDbDeps,
    openFolderVisibilityDb,
    type FolderVisibilityDatabase,
} from './folderVisibilitySqlite'

export type ViewRecord = {
    readonly viewId: string
    readonly name: string
    readonly isActive: boolean
}

export type CreatedView = {
    readonly viewId: string
    readonly name: string
}

export type CreateViewId = () => string

type ViewRow = {
    readonly view_id: string
    readonly name: string
    readonly is_active: number
}

type CountRow = {
    readonly count: number
}

export class ViewNotFoundError extends Error {
    constructor(viewId: string) {
        super(`View not found: ${viewId}`)
        this.name = 'ViewNotFoundError'
    }
}

export class ActiveViewDeleteError extends Error {
    constructor(viewId: string) {
        super(`Cannot delete active view "${viewId}"; switch to another view first`)
        this.name = 'ActiveViewDeleteError'
    }
}

function toViewRecord(row: ViewRow): ViewRecord {
    return {
        viewId: row.view_id,
        name: row.name,
        isActive: row.is_active === 1,
    }
}

function assertNonEmptyString(value: string, name: string): void {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string`)
    }
}

function createRandomViewId(): string {
    return randomUUID()
}

function getViewRow(db: FolderVisibilityDatabase, viewId: string): ViewRow | undefined {
    return db
        .prepare('SELECT view_id, name, is_active FROM views WHERE view_id = ?')
        .get(viewId) as ViewRow | undefined
}

function assertViewExists(db: FolderVisibilityDatabase, viewId: string): ViewRow {
    const row = getViewRow(db, viewId)
    if (!row) {
        throw new ViewNotFoundError(viewId)
    }
    return row
}

function activeViewCount(db: FolderVisibilityDatabase): number {
    const row = db
        .prepare('SELECT COUNT(*) AS count FROM views WHERE is_active = 1')
        .get() as CountRow
    return row.count
}

export function listViews(db: FolderVisibilityDatabase): readonly ViewRecord[] {
    return (db
        .prepare('SELECT view_id, name, is_active FROM views ORDER BY name COLLATE NOCASE, view_id')
        .all() as ViewRow[]).map(toViewRecord)
}

export function createView(
    db: FolderVisibilityDatabase,
    name: string,
    createViewId: CreateViewId = createRandomViewId,
): CreatedView {
    assertNonEmptyString(name, 'name')
    const viewId = createViewId()
    db.prepare('INSERT INTO views(view_id, name, is_active) VALUES (?, ?, 0)').run(viewId, name)
    return { viewId, name }
}

export function switchActiveView(db: FolderVisibilityDatabase, targetViewId: string): void {
    assertNonEmptyString(targetViewId, 'targetViewId')
    assertViewExists(db, targetViewId)

    const transaction = db.transaction(() => {
        db.prepare('UPDATE views SET is_active = 0 WHERE is_active = 1').run()
        db.prepare('UPDATE views SET is_active = 1 WHERE view_id = ?').run(targetViewId)

        const count = activeViewCount(db)
        if (count !== 1) {
            throw new Error(`Expected exactly 1 active view after switch, got ${count}`)
        }
    })
    transaction()
}

export function cloneView(
    db: FolderVisibilityDatabase,
    srcViewId: string,
    dstName: string,
    createViewId: CreateViewId = createRandomViewId,
): CreatedView {
    assertNonEmptyString(srcViewId, 'srcViewId')
    assertNonEmptyString(dstName, 'dstName')
    assertViewExists(db, srcViewId)

    const dstViewId = createViewId()
    const transaction = db.transaction(() => {
        db.prepare('INSERT INTO views(view_id, name, is_active) VALUES (?, ?, 0)').run(dstViewId, dstName)
        db.prepare(`
            INSERT INTO folder_visibility(view_id, path, state)
            SELECT ?, path, state FROM folder_visibility WHERE view_id = ?
        `).run(dstViewId, srcViewId)
    })
    transaction()
    return { viewId: dstViewId, name: dstName }
}

export function deleteView(db: FolderVisibilityDatabase, viewId: string): void {
    assertNonEmptyString(viewId, 'viewId')
    const row = assertViewExists(db, viewId)
    if (row.is_active === 1) {
        throw new ActiveViewDeleteError(viewId)
    }

    const transaction = db.transaction(() => {
        db.prepare('DELETE FROM folder_visibility WHERE view_id = ?').run(viewId)
        db.prepare('DELETE FROM views WHERE view_id = ?').run(viewId)
    })
    transaction()
}

export function getActiveViewId(db: FolderVisibilityDatabase): string {
    const rows = db
        .prepare('SELECT view_id FROM views WHERE is_active = 1')
        .all() as Array<{ view_id: string }>
    if (rows.length !== 1) {
        throw new Error(`Expected exactly 1 active view, got ${rows.length}`)
    }
    return rows[0].view_id
}

export function ensureDefaultView(
    db: FolderVisibilityDatabase,
    createViewId: CreateViewId = createRandomViewId,
): void {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM views').get() as CountRow).count
    if (count > 0) {
        return
    }
    db.prepare('INSERT INTO views(view_id, name, is_active) VALUES (?, ?, 1)').run(createViewId(), 'main')
}

export function ensureDefaultFolderVisibilityView(projectRoot: string): void {
    const folderVisibilityDb = openFolderVisibilityDb(projectRoot, defaultFolderVisibilityDbDeps)
    try {
        ensureDefaultView(folderVisibilityDb)
    } finally {
        closeFolderVisibilityDb(folderVisibilityDb)
    }
}
