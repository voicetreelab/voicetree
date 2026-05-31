/**
 * Pure planner for the 2.9.x → 3.0.0 user-data migration.
 *
 * Given the old (Electron `userData`) and new (`~/.voicetree`) config dirs and a
 * pure existence predicate, it decides which durable config files must move. No
 * filesystem access, no Electron — black-box testable by feeding dir-state in
 * and asserting the returned steps.
 */

import {join} from 'node:path';
import {MIGRATABLE_CONFIG_FILENAMES} from '../config-files.ts';

/** One file to relocate from `from` (old dir) to `to` (new dir). */
export interface MigrationStep {
    readonly filename: string;
    readonly from: string;
    readonly to: string;
}

/**
 * Plans the migration: a file is migrated iff it EXISTS at the old path AND is
 * ABSENT at the new path. The absent-at-new guard makes the migration idempotent
 * and is trustworthy only when this runs before the first `loadSettings()` (which
 * writes a default file at the new path on ENOENT) — hence the migration must
 * ship inside 3.0.0.
 *
 * @param oldDir Electron `userData` dir (2.9.x config root).
 * @param newDir `~/.voicetree` (3.0 config root).
 * @param exists Pure predicate over an absolute path (caller snapshots the FS).
 */
export function planUserDataMigration(
    oldDir: string,
    newDir: string,
    exists: (path: string) => boolean,
): MigrationStep[] {
    return MIGRATABLE_CONFIG_FILENAMES
        .map((filename): MigrationStep => ({
            filename,
            from: join(oldDir, filename),
            to: join(newDir, filename),
        }))
        .filter((step) => exists(step.from) && !exists(step.to));
}
