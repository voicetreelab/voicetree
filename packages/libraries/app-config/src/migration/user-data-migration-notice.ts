/**
 * Pure formatter for the non-blocking notice shown after a 2.9.x → 3.0 import.
 *
 * The migration runs silently in electron-main before any window exists; this
 * turns the migration summary into the one-line message the renderer surfaces
 * once the UI is ready. Pure and black-box testable.
 */

export interface UserDataMigrationNotice {
    /** settings.json and/or voicetree-config.json were imported. */
    readonly settingsImported: boolean;
    /** Number of recent projects imported from projects.json. */
    readonly projectCount: number;
}

/**
 * Renders the notice, or returns null when there is nothing user-meaningful to
 * announce (e.g. only an empty projects.json moved).
 */
export function formatUserDataMigrationNotice(notice: UserDataMigrationNotice): string | null {
    const parts: string[] = [];
    if (notice.settingsImported) {
        parts.push('your settings');
    }
    if (notice.projectCount === 1) {
        parts.push('1 recent project');
    } else if (notice.projectCount > 1) {
        parts.push(`${notice.projectCount} recent projects`);
    }
    if (parts.length === 0) {
        return null;
    }
    return `Imported ${parts.join(' & ')} from your previous version`;
}
