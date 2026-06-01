import {describe, expect, it} from 'vitest';
import {join} from 'node:path';
import {planUserDataMigration, type MigrationStep} from './plan-user-data-migration.ts';
import {
    MIGRATABLE_CONFIG_FILENAMES,
    PROJECTS_FILENAME,
    SETTINGS_FILENAME,
    VOICETREE_CONFIG_FILENAME,
} from '../config-files.ts';

const OLD: string = '/old/userData';
const NEW: string = '/home/.voicetree';

/** Build the `exists` predicate from an explicit set of present absolute paths. */
function existsIn(...paths: string[]): (p: string) => boolean {
    const present: Set<string> = new Set(paths);
    return (p) => present.has(p);
}

function step(filename: string): MigrationStep {
    return {filename, from: join(OLD, filename), to: join(NEW, filename)};
}

describe('planUserDataMigration', () => {
    it('migrates every file present-at-old and absent-at-new', () => {
        const exists = existsIn(...MIGRATABLE_CONFIG_FILENAMES.map((f) => join(OLD, f)));

        const steps: MigrationStep[] = planUserDataMigration(OLD, NEW, exists);

        expect(steps).toEqual([
            step(SETTINGS_FILENAME),
            step(PROJECTS_FILENAME),
            step(VOICETREE_CONFIG_FILENAME),
        ]);
    });

    it('skips files already present at the new path (absent-at-new guard)', () => {
        const exists = existsIn(
            ...MIGRATABLE_CONFIG_FILENAMES.map((f) => join(OLD, f)),
            ...MIGRATABLE_CONFIG_FILENAMES.map((f) => join(NEW, f)),
        );

        expect(planUserDataMigration(OLD, NEW, exists)).toEqual([]);
    });

    it('migrates only the files that exist at old and are absent at new', () => {
        // settings exists at both, projects only at old, voicetree-config nowhere.
        const exists = existsIn(
            join(OLD, SETTINGS_FILENAME),
            join(NEW, SETTINGS_FILENAME),
            join(OLD, PROJECTS_FILENAME),
        );

        expect(planUserDataMigration(OLD, NEW, exists)).toEqual([step(PROJECTS_FILENAME)]);
    });

    it('returns no steps when nothing exists at the old path', () => {
        expect(planUserDataMigration(OLD, NEW, existsIn())).toEqual([]);
    });
});
