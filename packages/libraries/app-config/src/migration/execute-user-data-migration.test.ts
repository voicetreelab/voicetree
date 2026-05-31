import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    executeUserDataMigration,
    USER_DATA_MIGRATION_MARKER_FILENAME,
    type UserDataMigrationResult,
} from './execute-user-data-migration.ts';
import {
    PROJECTS_FILENAME,
    SETTINGS_FILENAME,
    VOICETREE_CONFIG_FILENAME,
} from '../config-files.ts';

let oldDir: string;
let newDir: string;

const SETTINGS_BODY: string = JSON.stringify({userEmail: 'a@b.com', agents: [{name: 'X'}]}, null, 2);
const PROJECTS_BODY: string = JSON.stringify([{id: '1', path: '/p1'}, {id: '2', path: '/p2'}], null, 2);
const CONFIG_BODY: string = JSON.stringify({lastDirectory: '/p1'}, null, 2);

async function read(dir: string, filename: string): Promise<string> {
    return fs.readFile(join(dir, filename), 'utf-8');
}

async function exists(dir: string, filename: string): Promise<boolean> {
    try {
        await fs.access(join(dir, filename));
        return true;
    } catch {
        return false;
    }
}

beforeEach(async () => {
    const base: string = await fs.mkdtemp(join(tmpdir(), 'vt-migration-'));
    oldDir = join(base, 'userData');
    newDir = join(base, 'home');
    await fs.mkdir(oldDir, {recursive: true});
});

afterEach(async () => {
    // base is the parent of both oldDir and newDir.
    await fs.rm(join(oldDir, '..'), {recursive: true, force: true});
});

describe('executeUserDataMigration', () => {
    it('moves all three files to the new dir, preserves content, deletes originals, writes the marker', async () => {
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), SETTINGS_BODY);
        await fs.writeFile(join(oldDir, PROJECTS_FILENAME), PROJECTS_BODY);
        await fs.writeFile(join(oldDir, VOICETREE_CONFIG_FILENAME), CONFIG_BODY);

        const result: UserDataMigrationResult = await executeUserDataMigration({oldDir, newDir});

        // New dir holds byte-identical content.
        expect(await read(newDir, SETTINGS_FILENAME)).toBe(SETTINGS_BODY);
        expect(await read(newDir, PROJECTS_FILENAME)).toBe(PROJECTS_BODY);
        expect(await read(newDir, VOICETREE_CONFIG_FILENAME)).toBe(CONFIG_BODY);

        // Originals are gone (clean move leaves nothing behind).
        expect(await exists(oldDir, SETTINGS_FILENAME)).toBe(false);
        expect(await exists(oldDir, PROJECTS_FILENAME)).toBe(false);
        expect(await exists(oldDir, VOICETREE_CONFIG_FILENAME)).toBe(false);

        // Result + provenance marker.
        expect(result.alreadyMigrated).toBe(false);
        expect([...result.migratedFiles].sort()).toEqual(
            [SETTINGS_FILENAME, PROJECTS_FILENAME, VOICETREE_CONFIG_FILENAME].sort(),
        );
        const marker = JSON.parse(await read(newDir, USER_DATA_MIGRATION_MARKER_FILENAME)) as {
            fromDir: string;
            migratedFiles: string[];
            migratedAt: string;
        };
        expect(marker.fromDir).toBe(oldDir);
        expect([...marker.migratedFiles].sort()).toEqual(
            [SETTINGS_FILENAME, PROJECTS_FILENAME, VOICETREE_CONFIG_FILENAME].sort(),
        );
        expect(typeof marker.migratedAt).toBe('string');
    });

    it('is idempotent: a second run is a no-op and never re-touches the new files', async () => {
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), SETTINGS_BODY);

        await executeUserDataMigration({oldDir, newDir});
        // A user edits their (now-migrated) settings between launches.
        const edited: string = JSON.stringify({userEmail: 'edited@b.com'}, null, 2);
        await fs.writeFile(join(newDir, SETTINGS_FILENAME), edited);

        const second: UserDataMigrationResult = await executeUserDataMigration({oldDir, newDir});

        expect(second).toEqual({migratedFiles: [], alreadyMigrated: true});
        expect(await read(newDir, SETTINGS_FILENAME)).toBe(edited);
    });

    it('migrates only the files that exist at the old path', async () => {
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), SETTINGS_BODY);

        const result: UserDataMigrationResult = await executeUserDataMigration({oldDir, newDir});

        expect(result.migratedFiles).toEqual([SETTINGS_FILENAME]);
        expect(await read(newDir, SETTINGS_FILENAME)).toBe(SETTINGS_BODY);
        expect(await exists(newDir, PROJECTS_FILENAME)).toBe(false);
        expect(await exists(newDir, VOICETREE_CONFIG_FILENAME)).toBe(false);
    });

    it('never clobbers a file that already exists at the new path, and leaves its original intact', async () => {
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), SETTINGS_BODY);
        await fs.mkdir(newDir, {recursive: true});
        const defaultAtNew: string = JSON.stringify({_default: true}, null, 2);
        await fs.writeFile(join(newDir, SETTINGS_FILENAME), defaultAtNew);

        const result: UserDataMigrationResult = await executeUserDataMigration({oldDir, newDir});

        // Absent-at-new guard fired: nothing migrated, new file untouched, old left intact.
        expect(result.migratedFiles).toEqual([]);
        expect(await read(newDir, SETTINGS_FILENAME)).toBe(defaultAtNew);
        expect(await read(oldDir, SETTINGS_FILENAME)).toBe(SETTINGS_BODY);
        // No real migration happened, so no marker is written.
        expect(await exists(newDir, USER_DATA_MIGRATION_MARKER_FILENAME)).toBe(false);
    });

    it('does nothing and writes no marker when there is no old data', async () => {
        const result: UserDataMigrationResult = await executeUserDataMigration({oldDir, newDir});

        expect(result).toEqual({migratedFiles: [], alreadyMigrated: false});
        expect(await exists(newDir, USER_DATA_MIGRATION_MARKER_FILENAME)).toBe(false);
    });
});
