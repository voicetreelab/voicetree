/**
 * Electron-main edge for the 2.9.x → 3.0.0 user-data migration.
 *
 * The only Electron-aware layer: it supplies the old dir (`app.getPath('userData')`,
 * which still resolves the 2.9.x config root because the product name is unchanged)
 * and the new dir (`resolveVoicetreeHomePath()` = `~/.voicetree`), delegates the
 * clean move to the pure/impure core in `@vt/app-config`, then stashes a one-time
 * notice for the renderer to surface once the UI is ready.
 */

import {app} from 'electron';
import log from 'electron-log';
import {resolveVoicetreeHomePath} from '@vt/paths';
import {
    executeUserDataMigration,
    formatUserDataMigrationNotice,
    loadProjects,
    PROJECTS_FILENAME,
    SETTINGS_FILENAME,
    VOICETREE_CONFIG_FILENAME,
    type UserDataMigrationResult,
} from '@vt/app-config';

// One-shot, in-memory. The migration runs at most once per home dir (guarded by
// the on-disk marker), so this is only ever set on the single first-3.0 launch of
// a returning 2.9.x user. The renderer consumes it once after the window loads.
let pendingNoticeMessage: string | null = null;

/** Returns the pending import-notice message once, then clears it. */
export function consumeUserDataMigrationNotice(): string | null {
    const message: string | null = pendingNoticeMessage;
    pendingNoticeMessage = null;
    return message;
}

/**
 * Migrates a returning 2.9.x user's durable config (settings.json, projects.json,
 * voicetree-config.json) from the old Electron userData dir to `~/.voicetree`.
 *
 * MUST run before the first `loadSettings()` — which writes DEFAULT_SETTINGS at the
 * new path on ENOENT and would defeat the absent-at-new guard. Never throws into
 * startup: on failure the old data is left intact (the clean move deletes only
 * after a verified copy), so the next launch simply retries.
 */
export async function runUserDataMigrationAtStartup(): Promise<void> {
    try {
        const result: UserDataMigrationResult = await executeUserDataMigration({
            oldDir: app.getPath('userData'),
            newDir: resolveVoicetreeHomePath(),
        });

        if (result.migratedFiles.length === 0) {
            return;
        }

        log.info(`[userData-migration] imported ${result.migratedFiles.join(', ')} from previous version`);

        const settingsImported: boolean =
            result.migratedFiles.includes(SETTINGS_FILENAME) ||
            result.migratedFiles.includes(VOICETREE_CONFIG_FILENAME);
        // loadProjects() reads the just-migrated projects.json from ~/.voicetree and
        // drops entries whose path no longer exists — i.e. the count the user will
        // actually see in their recents.
        const projectCount: number = result.migratedFiles.includes(PROJECTS_FILENAME)
            ? (await loadProjects()).length
            : 0;

        pendingNoticeMessage = formatUserDataMigrationNotice({settingsImported, projectCount});
    } catch (error) {
        log.error(`[userData-migration] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
