import {
    stripTrailingSlash,
} from './folderVisibility/derive'
import type {
    AbsolutePath,
    FolderState,
    FolderVisibilityState,
} from './folderVisibility/types'

export interface FolderVisibilityUpdate {
    readonly path: AbsolutePath
    readonly state: FolderState
}

interface StatementRunResult {
    readonly changes: number
}

interface Statement<T = unknown> {
    readonly all?: (...params: readonly unknown[]) => T[]
    readonly get?: (...params: readonly unknown[]) => T | undefined
    readonly run?: (...params: readonly unknown[]) => StatementRunResult
}

export interface FolderVisibilityDatabase {
    readonly prepare: <T = unknown>(sql: string) => Statement<T>
    readonly transaction: <Args extends readonly unknown[], Result>(
        fn: (...args: Args) => Result,
    ) => (...args: Args) => Result
}

interface FolderVisibilityRow {
    readonly path: string
    readonly state: FolderState
}

let database: FolderVisibilityDatabase | undefined

export type FolderStateChangedListener = () => void

const folderStateChangedListeners = new Set<FolderStateChangedListener>()

export function onFolderStateChanged(listener: FolderStateChangedListener): () => void {
    folderStateChangedListeners.add(listener)
    return (): void => {
        folderStateChangedListeners.delete(listener)
    }
}

function emitFolderStateChanged(): void {
    for (const listener of folderStateChangedListeners) {
        listener()
    }
}

export function configureFolderVisibilityStore(db: FolderVisibilityDatabase): void {
    database = db
}

export function clearFolderVisibilityStoreForTests(): void {
    database = undefined
    folderStateChangedListeners.clear()
}

export function getFolderVisibility(viewId: string): FolderVisibilityState {
    const rows = allRows(viewId)
    return new Map(rows.map((row) => [row.path, row.state]))
}

export function setFolderState(
    viewId: string,
    path: AbsolutePath,
    state: FolderState,
): void {
    const db = requireDatabase()
    const statement = requireRunStatement(db.prepare(`
        INSERT INTO folder_visibility (view_id, path, state)
        VALUES (?, ?, ?)
        ON CONFLICT(view_id, path) DO UPDATE SET state = excluded.state
    `))
    statement.run(viewId, normalizePath(path), state)
    emitFolderStateChanged()
}

export function setFolderStateBatch(
    viewId: string,
    updates: readonly FolderVisibilityUpdate[],
): void {
    const db = requireDatabase()
    const statement = requireRunStatement(db.prepare(`
        INSERT INTO folder_visibility (view_id, path, state)
        VALUES (?, ?, ?)
        ON CONFLICT(view_id, path) DO UPDATE SET state = excluded.state
    `))
    const applyUpdates = db.transaction((batch: readonly FolderVisibilityUpdate[]) => {
        for (const update of batch) {
            statement.run(viewId, normalizePath(update.path), update.state)
        }
    })
    applyUpdates(updates)
    emitFolderStateChanged()
}

export function own(viewId: string, path: AbsolutePath): FolderState {
    const db = requireDatabase()
    const statement = requireGetStatement<Pick<FolderVisibilityRow, 'state'>>(db.prepare(`
        SELECT state
        FROM folder_visibility
        WHERE view_id = ? AND path = ?
    `))
    return statement.get(viewId, normalizePath(path))?.state ?? 'hidden'
}

export function effective(viewId: string, path: AbsolutePath): FolderState {
    return own(viewId, path)
}

function allRows(viewId: string): FolderVisibilityRow[] {
    const db = requireDatabase()
    const statement = requireAllStatement<FolderVisibilityRow>(db.prepare(`
        SELECT path, state
        FROM folder_visibility
        WHERE view_id = ?
        ORDER BY path ASC
    `))
    return statement.all(viewId)
}

function normalizePath(path: AbsolutePath): AbsolutePath {
    return stripTrailingSlash(path)
}

function requireDatabase(): FolderVisibilityDatabase {
    if (database === undefined) {
        throw new Error('folderVisibilityStore is not configured with a sqlite database')
    }
    return database
}

function requireAllStatement<T>(
    statement: Statement<T>,
): Required<Pick<Statement<T>, 'all'>> {
    if (typeof statement.all !== 'function') {
        throw new Error('folderVisibilityStore expected a sqlite statement with all()')
    }
    return statement as Required<Pick<Statement<T>, 'all'>>
}

function requireGetStatement<T>(
    statement: Statement<T>,
): Required<Pick<Statement<T>, 'get'>> {
    if (typeof statement.get !== 'function') {
        throw new Error('folderVisibilityStore expected a sqlite statement with get()')
    }
    return statement as Required<Pick<Statement<T>, 'get'>>
}

function requireRunStatement(
    statement: Statement,
): Required<Pick<Statement, 'run'>> {
    if (typeof statement.run !== 'function') {
        throw new Error('folderVisibilityStore expected a sqlite statement with run()')
    }
    return statement as Required<Pick<Statement, 'run'>>
}
