/**
 * BF-238 Phase 1 — sqlite I/O layer for unified folder-visibility (Decision 2).
 *
 * Pure I/O: open / migrate / close. No business logic. The canonical store
 * (BF-239) and views CRUD (BF-243) build on these primitives.
 *
 * Schema is kept additive and idempotent: `runSchemaMigrations` may be invoked
 * on a brand-new database or on an existing one without altering rows. Schema
 * version is tracked via `PRAGMA user_version` so future migrations can no-op
 * against fresh DBs.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'

export const FOLDER_VISIBILITY_DB_FILENAME = 'folder-visibility.db'

/** Current schema version. Bump when adding a non-trivial migration step. */
export const FOLDER_VISIBILITY_SCHEMA_VERSION = 1

type TransactionFn<T extends (...args: any[]) => unknown> = (...args: Parameters<T>) => ReturnType<T>

export type FolderVisibilityDatabase = DatabaseSync & {
    transaction<T extends (...args: any[]) => unknown>(fn: T): TransactionFn<T>
}

/**
 * Shell-injected dependencies for opening the folder-visibility db.
 * Threading these in (rather than referencing `fs.mkdirSync` / `new
 * DatabaseSync` directly inside `openFolderVisibilityDb`) keeps the public
 * surface honest about what concrete I/O it requires, and keeps every
 * transitive caller out of the purity-graph's impure reach.
 */
export interface FolderVisibilityDbDeps {
    readonly mkdir: (dir: string, opts: { recursive: true }) => void
    readonly openDatabase: (filePath: string) => DatabaseSync
}

/** Default real-IO deps. Constructed once at module load so every callsite
 * shares the same shell binding; tests can pass an alternative shape. */
export const defaultFolderVisibilityDbDeps: FolderVisibilityDbDeps = {
    mkdir: mkdirSync,
    openDatabase: (filePath: string) => new DatabaseSync(filePath),
}

/**
 * Resolve `<projectRoot>/.voicetree/folder-visibility.db`.
 */
export function resolveFolderVisibilityDbPath(projectRoot: string): string {
    return path.join(getProjectDotVoicetreePath(projectRoot), FOLDER_VISIBILITY_DB_FILENAME)
}

function assertValidProjectPath(projectRoot: string): void {
    if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
        throw new Error('openFolderVisibilityDb: projectRoot must be a non-empty string')
    }
}

function prepareFolderVisibilityDb(db: FolderVisibilityDatabase): FolderVisibilityDatabase {
    db.exec('PRAGMA journal_mode = WAL')
    runSchemaMigrations(db)
    return db
}

/**
 * Open (or create) the folder-visibility sqlite db for a project.
 *
 * - Creates `<projectRoot>/.voicetree/` if missing.
 * - Sets `journal_mode = WAL` (Decision 2: concurrent readers, single writer).
 * - Runs schema migrations (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * The caller owns the returned Database handle and must close it via
 * {@link closeFolderVisibilityDb}.
 *
 * `deps` is required: callers thread fs/db constructors in from the shell
 * boundary so this leaf does not capture the impure namespace itself.
 *
 * Throws if `projectRoot` is empty/invalid or the parent directory cannot be
 * created.
 */
export function openFolderVisibilityDb(
    projectRoot: string,
    deps: FolderVisibilityDbDeps,
): FolderVisibilityDatabase {
    assertValidProjectPath(projectRoot)
    const dbPath = resolveFolderVisibilityDbPath(projectRoot)
    deps.mkdir(path.dirname(dbPath), { recursive: true })

    const db = addTransactionMethod(deps.openDatabase(dbPath))
    return prepareFolderVisibilityDb(db)
}

function addTransactionMethod(db: DatabaseSync): FolderVisibilityDatabase {
    return Object.assign(db, {
        transaction<T extends (...args: any[]) => unknown>(fn: T): TransactionFn<T> {
            return ((...args: Parameters<T>): ReturnType<T> => {
                if (db.isTransaction) {
                    return fn(...args) as ReturnType<T>
                }

                db.exec('BEGIN')
                try {
                    const result = fn(...args) as ReturnType<T>
                    db.exec('COMMIT')
                    return result
                } catch (error) {
                    db.exec('ROLLBACK')
                    throw error
                }
            }) as TransactionFn<T>
        },
    })
}

/**
 * Idempotent schema setup. Safe to call against a fresh DB or an already-
 * migrated DB. Per Decision 2:
 *
 *   folder_visibility (view_id, path, state) PK (view_id, path)
 *   views             (view_id PK, name, is_active)
 *   idx_fv_view       on folder_visibility(view_id)
 *
 * Bumps `PRAGMA user_version` to {@link FOLDER_VISIBILITY_SCHEMA_VERSION}.
 */
export function runSchemaMigrations(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS folder_visibility (
            view_id TEXT NOT NULL,
            path    TEXT NOT NULL,
            state   TEXT NOT NULL CHECK (state IN ('expanded','collapsed','hidden')),
            PRIMARY KEY (view_id, path)
        );
        CREATE TABLE IF NOT EXISTS views (
            view_id   TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_fv_view ON folder_visibility(view_id);
    `)
    db.exec(`PRAGMA user_version = ${FOLDER_VISIBILITY_SCHEMA_VERSION}`)
}

/**
 * Close a previously opened db. Safe to call once; callers should not invoke
 * this twice on the same handle.
 */
export function closeFolderVisibilityDb(db: DatabaseSync): void {
    db.close()
}
