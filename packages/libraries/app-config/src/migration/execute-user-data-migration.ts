/**
 * Impure executor for the 2.9.x → 3.0.0 user-data migration.
 *
 * Performs the clean move (copy → verify read-back → delete original) for every
 * file the pure planner selects, then writes a provenance marker. It touches the
 * filesystem but knows nothing of Electron — it takes the two dirs as arguments,
 * so it is black-box testable against real temp dirs.
 */

import {promises as fs} from 'node:fs';
import {dirname, join} from 'node:path';
import {MIGRATABLE_CONFIG_FILENAMES} from '../config-files.ts';
import {planUserDataMigration, type MigrationStep} from './plan-user-data-migration.ts';

/**
 * Marker written at the new home dir after a successful migration. Its presence
 * means "this home was already imported from userData — never migrate again".
 */
export const USER_DATA_MIGRATION_MARKER_FILENAME: string = '.migrated-from-userData';

export interface UserDataMigrationParams {
    /** Electron `userData` dir — the 2.9.x config root (migration source). */
    readonly oldDir: string;
    /** `~/.voicetree` — the 3.0 config root (migration destination). */
    readonly newDir: string;
}

export interface UserDataMigrationResult {
    /** Basenames moved (copied, verified, original deleted) this run. */
    readonly migratedFiles: readonly string[];
    /** True when a prior marker was found and the whole migration was skipped. */
    readonly alreadyMigrated: boolean;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Clean move of one file: copy → verify the read-back is byte-identical → delete
 * the original. The original is removed ONLY after the copy is verified, so an
 * interrupted run never loses data. A failed/partial copy is cleaned up so the
 * destination stays absent — preserving the absent-at-new guard for a clean retry.
 */
async function moveFileVerified(from: string, to: string): Promise<void> {
    const data: Buffer = await fs.readFile(from);
    await fs.mkdir(dirname(to), {recursive: true});
    try {
        await fs.writeFile(to, data);
        const readBack: Buffer = await fs.readFile(to);
        if (!readBack.equals(data)) {
            throw new Error(`read-back mismatch for ${to}`);
        }
    } catch (error) {
        // Copy or verify failed — remove any partial destination so the source
        // stays the single source of truth and the next launch can retry.
        await fs.rm(to, {force: true});
        throw error;
    }
    // Copy verified; the destination now holds the user's data safely. Removing
    // the original is the last step — if it fails the data is still preserved.
    await fs.rm(from);
}

async function writeMarker(markerPath: string, fromDir: string, migratedFiles: readonly string[]): Promise<void> {
    const marker: {migratedAt: string; fromDir: string; migratedFiles: readonly string[]} = {
        migratedAt: new Date().toISOString(),
        fromDir,
        migratedFiles,
    };
    await fs.mkdir(dirname(markerPath), {recursive: true});
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf-8');
}

/**
 * Runs the migration once. No-op (empty result) when a marker already exists or
 * when nothing needs moving. Writes the marker only after at least one file is
 * successfully moved.
 */
export async function executeUserDataMigration(
    params: UserDataMigrationParams,
): Promise<UserDataMigrationResult> {
    const {oldDir, newDir} = params;
    const markerPath: string = join(newDir, USER_DATA_MIGRATION_MARKER_FILENAME);

    if (await pathExists(markerPath)) {
        return {migratedFiles: [], alreadyMigrated: true};
    }

    // Snapshot existence of every candidate path up front, then plan purely over
    // the snapshot (the planner stays a pure function of dir-state).
    const candidates: string[] = MIGRATABLE_CONFIG_FILENAMES.flatMap(
        (filename) => [join(oldDir, filename), join(newDir, filename)],
    );
    const present: Set<string> = new Set<string>();
    await Promise.all(candidates.map(async (path) => {
        if (await pathExists(path)) present.add(path);
    }));

    const steps: MigrationStep[] = planUserDataMigration(oldDir, newDir, (path) => present.has(path));

    const migratedFiles: string[] = [];
    for (const step of steps) {
        await moveFileVerified(step.from, step.to);
        migratedFiles.push(step.filename);
    }

    if (migratedFiles.length > 0) {
        await writeMarker(markerPath, oldDir, migratedFiles);
    }

    return {migratedFiles, alreadyMigrated: false};
}
