/**
 * Deep entry point for the 2.9.x → 3.0.0 user-data migration.
 *
 * This is the single symbol the Electron edge depends on: it performs the clean
 * move (delegated to the executor) and turns the result into the one-line notice
 * the renderer surfaces. Keeping this orchestration inside @vt/app-config means the
 * webapp edge imports exactly one value symbol from this package for the migration —
 * the public API is one deep function, not its internals.
 */

import {PROJECTS_FILENAME, SETTINGS_FILENAME, VOICETREE_CONFIG_FILENAME} from '../config-files.ts';
import {loadProjects} from '../project/project-store.ts';
import {executeUserDataMigration} from './execute-user-data-migration.ts';
import {formatUserDataMigrationNotice} from './user-data-migration-notice.ts';

export interface UserDataMigrationOutcome {
    /** Basenames moved this run (empty when nothing migrated). */
    readonly migratedFiles: readonly string[];
    /** Ready-to-show notice, or null when there is nothing user-meaningful to announce. */
    readonly noticeMessage: string | null;
}

/**
 * Runs the migration from `oldDir` (Electron `userData`) to `newDir` (`~/.voicetree`)
 * and returns the moved files plus the notice. The project count in the notice is the
 * validated count the user will actually see — via `loadProjects()`, which reads the
 * just-migrated `projects.json` from the resolved home and drops entries whose path no
 * longer exists.
 */
export async function runUserDataMigration(
    oldDir: string,
    newDir: string,
): Promise<UserDataMigrationOutcome> {
    const {migratedFiles} = await executeUserDataMigration({oldDir, newDir});
    if (migratedFiles.length === 0) {
        return {migratedFiles: [], noticeMessage: null};
    }

    const settingsImported: boolean =
        migratedFiles.includes(SETTINGS_FILENAME) || migratedFiles.includes(VOICETREE_CONFIG_FILENAME);
    const projectCount: number = migratedFiles.includes(PROJECTS_FILENAME)
        ? (await loadProjects()).length
        : 0;

    return {
        migratedFiles,
        noticeMessage: formatUserDataMigrationNotice({settingsImported, projectCount}),
    };
}
