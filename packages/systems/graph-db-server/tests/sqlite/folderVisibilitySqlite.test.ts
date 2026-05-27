/**
 * BF-238 — sqlite I/O layer tests.
 *
 * Verifies open/migrate/close primitives against real sqlite (no mocks).
 * Each test uses an isolated tmpdir vault.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    FOLDER_VISIBILITY_DB_RELATIVE_PATH,
    FOLDER_VISIBILITY_SCHEMA_VERSION,
    closeFolderVisibilityDb,
    defaultFolderVisibilityDbDeps,
    openFolderVisibilityDb,
    resolveFolderVisibilityDbPath,
    runSchemaMigrations,
} from '../../src/data/views/folderVisibilitySqlite'

const tmpVaults: string[] = []

function makeVault(): string {
    const v = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-sqlite-test-'))
    tmpVaults.push(v)
    return v
}

afterEach(() => {
    while (tmpVaults.length) {
        const v = tmpVaults.pop()!
        fs.rmSync(v, { recursive: true, force: true })
    }
})

describe('folderVisibilitySqlite', () => {
    it('cold-open creates <vault>/.voicetree/ and the db file', () => {
        const vault = makeVault()
        // Ensure the .voicetree dir does not pre-exist.
        expect(fs.existsSync(path.join(vault, '.voicetree'))).toBe(false)

        const db = openFolderVisibilityDb(vault, defaultFolderVisibilityDbDeps)
        try {
            const dbPath = resolveFolderVisibilityDbPath(vault)
            expect(dbPath).toBe(path.join(vault, FOLDER_VISIBILITY_DB_RELATIVE_PATH))
            expect(fs.existsSync(dbPath)).toBe(true)
            expect(fs.statSync(path.join(vault, '.voicetree')).isDirectory()).toBe(true)
        } finally {
            closeFolderVisibilityDb(db)
        }
    })

    it('sets journal_mode = WAL on cold open', () => {
        const vault = makeVault()
        const db = openFolderVisibilityDb(vault, defaultFolderVisibilityDbDeps)
        try {
            const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
            expect(mode.journal_mode).toBe('wal')
        } finally {
            closeFolderVisibilityDb(db)
        }
    })

    it('creates folder_visibility + views tables and idx_fv_view index', () => {
        const vault = makeVault()
        const db = openFolderVisibilityDb(vault, defaultFolderVisibilityDbDeps)
        try {
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((r: any) => r.name as string)
            expect(tables).toContain('folder_visibility')
            expect(tables).toContain('views')

            const fvCols = db.prepare('PRAGMA table_info(folder_visibility)').all() as Array<{ name: string }>
            expect(fvCols.map((c) => c.name).sort()).toEqual(['path', 'state', 'view_id'])

            const viewsCols = db.prepare('PRAGMA table_info(views)').all() as Array<{ name: string }>
            expect(viewsCols.map((c) => c.name).sort()).toEqual(['is_active', 'name', 'view_id'])

            const indexes = db
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='folder_visibility'")
                .all()
                .map((r: any) => r.name as string)
            expect(indexes).toContain('idx_fv_view')

            // CHECK constraint on state must reject illegal values.
            expect(() =>
                db
                    .prepare('INSERT INTO folder_visibility(view_id, path, state) VALUES (?, ?, ?)')
                    .run('main', '/tmp/example', 'bogus'),
            ).toThrow()

            // Schema version is set.
            const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(FOLDER_VISIBILITY_SCHEMA_VERSION)
        } finally {
            closeFolderVisibilityDb(db)
        }
    })

    it('re-open is idempotent (data survives, schema migrations no-op)', () => {
        const vault = makeVault()

        // First open: write a row.
        const db1 = openFolderVisibilityDb(vault, defaultFolderVisibilityDbDeps)
        db1.prepare('INSERT INTO views(view_id, name, is_active) VALUES (?, ?, 1)').run('main', 'main')
        db1
            .prepare('INSERT INTO folder_visibility(view_id, path, state) VALUES (?, ?, ?)')
            .run('main', '/tmp/example', 'expanded')
        closeFolderVisibilityDb(db1)

        // Second open: row still there, schema unchanged, migrations don't error.
        const db2 = openFolderVisibilityDb(vault, defaultFolderVisibilityDbDeps)
        try {
            const row = db2
                .prepare('SELECT view_id, path, state FROM folder_visibility WHERE path = ?')
                .get('/tmp/example') as { view_id: string; path: string; state: string } | undefined
            expect(row).toEqual({ view_id: 'main', path: '/tmp/example', state: 'expanded' })

            const activeName = db2
                .prepare('SELECT name FROM views WHERE is_active = 1')
                .get() as { name: string } | undefined
            expect(activeName?.name).toBe('main')

            // runSchemaMigrations on an already-migrated DB is safe.
            expect(() => runSchemaMigrations(db2)).not.toThrow()

            // Schema version stays at the current version.
            const version = db2.prepare('PRAGMA user_version').get() as { user_version: number }
            expect(version.user_version).toBe(FOLDER_VISIBILITY_SCHEMA_VERSION)
        } finally {
            closeFolderVisibilityDb(db2)
        }
    })

    it('rejects bad inputs cleanly', () => {
        // Empty / wrong-typed vaultPath.
        expect(() => openFolderVisibilityDb('', defaultFolderVisibilityDbDeps)).toThrow(/non-empty string/)
        // @ts-expect-error — runtime guard for non-string input
        expect(() => openFolderVisibilityDb(null, defaultFolderVisibilityDbDeps)).toThrow(/non-empty string/)
        // @ts-expect-error — runtime guard for non-string input
        expect(() => openFolderVisibilityDb(undefined, defaultFolderVisibilityDbDeps)).toThrow(/non-empty string/)

        // Vault path under a non-existent, non-creatable parent (a regular file
        // instead of a directory) — fs.mkdirSync surfaces a clear error rather
        // than silently corrupting state.
        const vault = makeVault()
        const blocker = path.join(vault, 'blocker')
        fs.writeFileSync(blocker, 'not-a-dir')
        // Treat the regular file as if it were a vault path — `<blocker>/.voicetree/...`
        // cannot be created because `<blocker>` is a file.
        expect(() => openFolderVisibilityDb(blocker, defaultFolderVisibilityDbDeps)).toThrow()
    })

    it('runSchemaMigrations is idempotent on an externally-created db', () => {
        // Sanity check: callers may want to migrate a db they opened themselves.
        const vault = makeVault()
        const dbPath = resolveFolderVisibilityDbPath(vault)
        fs.mkdirSync(path.dirname(dbPath), { recursive: true })
        const db = new DatabaseSync(dbPath)
        try {
            runSchemaMigrations(db)
            runSchemaMigrations(db)
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((r: any) => r.name as string)
            expect(tables).toEqual(expect.arrayContaining(['folder_visibility', 'views']))
        } finally {
            db.close()
        }
    })
})
