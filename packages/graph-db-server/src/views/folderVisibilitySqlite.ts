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

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const FOLDER_VISIBILITY_DB_RELATIVE_PATH = '.voicetree/folder-visibility.db'

/** Current schema version. Bump when adding a non-trivial migration step. */
export const FOLDER_VISIBILITY_SCHEMA_VERSION = 1

export type FolderVisibilityDatabase = Database.Database

/**
 * Resolve `<vaultPath>/.voicetree/folder-visibility.db`.
 */
export function resolveFolderVisibilityDbPath(vaultPath: string): string {
    return path.join(vaultPath, FOLDER_VISIBILITY_DB_RELATIVE_PATH)
}

/**
 * Open (or create) the folder-visibility sqlite db for a vault.
 *
 * - Creates `<vaultPath>/.voicetree/` if missing.
 * - Sets `journal_mode = WAL` (Decision 2: concurrent readers, single writer).
 * - Runs schema migrations (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * The caller owns the returned Database handle and must close it via
 * {@link closeFolderVisibilityDb}.
 *
 * Throws if `vaultPath` is empty/invalid or the parent directory cannot be
 * created.
 */
export function openFolderVisibilityDb(vaultPath: string): FolderVisibilityDatabase {
    if (typeof vaultPath !== 'string' || vaultPath.length === 0) {
        throw new Error('openFolderVisibilityDb: vaultPath must be a non-empty string')
    }
    const dbPath = resolveFolderVisibilityDbPath(vaultPath)
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    runSchemaMigrations(db)
    return db
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
export function runSchemaMigrations(db: FolderVisibilityDatabase): void {
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
    db.pragma(`user_version = ${FOLDER_VISIBILITY_SCHEMA_VERSION}`)
}

/**
 * Close a previously opened db. Safe to call once; better-sqlite3 throws on
 * double-close, so callers should not invoke this twice on the same handle.
 */
export function closeFolderVisibilityDb(db: FolderVisibilityDatabase): void {
    db.close()
}
