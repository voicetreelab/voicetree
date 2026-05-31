/**
 * Electron-main edge for the 2.9.x → 3.0.0 user-data migration.
 *
 * The only Electron-aware layer: it supplies the old dir (`app.getPath('userData')`,
 * which still resolves the 2.9.x config root because the product name is unchanged)
 * and the new dir (`resolveVoicetreeHomePath()` = `~/.voicetree`), delegates the whole
 * migration to the single `runUserDataMigration` entry point in `@vt/app-config`, then
 * stashes the one-time notice for the renderer to surface once the UI is ready.
 */

import {app} from 'electron';
import log from 'electron-log';
import {resolveVoicetreeHomePath} from '@vt/paths';
import {runUserDataMigration} from '@vt/app-config';

// One-shot, in-memory. The migration runs at most once per home dir (guarded by the
// on-disk marker), so this is only ever set on the single first-3.0 launch of a
// returning 2.9.x user. The renderer consumes it once after the window loads.
let pendingNoticeMessage: string | null = null;

/** Returns the pending import-notice message once, then clears it. */
export function consumeUserDataMigrationNotice(): string | null {
    const message: string | null = pendingNoticeMessage;
    pendingNoticeMessage = null;
    return message;
}

/**
 * Migrates a returning 2.9.x user's durable config (settings.json, projects.json,
 * voicetree-config.json) from the old Electron `userData` dir to `~/.voicetree`.
 *
 * MUST run before the first `loadSettings()` — which writes DEFAULT_SETTINGS at the
 * new path on ENOENT and would defeat the absent-at-new guard. Never throws into
 * startup: on failure the old data is left intact (the clean move deletes only after
 * a verified copy), so the next launch simply retries.
 */
export async function runUserDataMigrationAtStartup(): Promise<void> {
    try {
        const {migratedFiles, noticeMessage} = await runUserDataMigration(
            app.getPath('userData'),
            resolveVoicetreeHomePath(),
        );

        if (migratedFiles.length === 0) {
            return;
        }

        log.info(`[userData-migration] imported ${migratedFiles.join(', ')} from previous version`);
        pendingNoticeMessage = noticeMessage;
    } catch (error) {
        log.error(`[userData-migration] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
