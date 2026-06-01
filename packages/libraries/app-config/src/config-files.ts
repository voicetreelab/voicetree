/**
 * Canonical basenames of VoiceTree's durable config files.
 *
 * Single source of truth shared by the IO modules that read/write each file and
 * by the 2.9.x→3.0 user-data migration that relocates them. Keeping the names
 * here means the migration can never drift from the files the app actually uses.
 */

export const SETTINGS_FILENAME: string = 'settings.json';
export const PROJECTS_FILENAME: string = 'projects.json';
export const VOICETREE_CONFIG_FILENAME: string = 'voicetree-config.json';

/**
 * The durable config files relocated from the Electron `userData` dir to
 * `~/.voicetree` in 3.0.0. These are exactly the files the first-launch
 * migration moves; everything else under `userData` is regenerated or stays.
 */
export const MIGRATABLE_CONFIG_FILENAMES: readonly string[] = [
    SETTINGS_FILENAME,
    PROJECTS_FILENAME,
    VOICETREE_CONFIG_FILENAME,
];
