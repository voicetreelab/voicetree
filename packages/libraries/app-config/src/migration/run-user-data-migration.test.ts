import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runUserDataMigration} from './run-user-data-migration.ts';
import {PROJECTS_FILENAME, SETTINGS_FILENAME} from '../config-files.ts';

let base: string;
let oldDir: string;
let newDir: string;
let prevHome: string | undefined;

beforeEach(async () => {
    base = await fs.mkdtemp(join(tmpdir(), 'vt-run-migration-'));
    oldDir = join(base, 'userData');
    newDir = join(base, 'home');
    await fs.mkdir(oldDir, {recursive: true});
    // loadProjects() (used for the notice's project count) resolves the home via
    // VOICETREE_HOME_PATH — point it at newDir so it reads the just-migrated file.
    prevHome = process.env.VOICETREE_HOME_PATH;
    process.env.VOICETREE_HOME_PATH = newDir;
});

afterEach(async () => {
    if (prevHome === undefined) {
        delete process.env.VOICETREE_HOME_PATH;
    } else {
        process.env.VOICETREE_HOME_PATH = prevHome;
    }
    await fs.rm(base, {recursive: true, force: true});
});

describe('runUserDataMigration', () => {
    it('migrates settings only and returns a settings-only notice', async () => {
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), JSON.stringify({userEmail: 'a@b.com'}));

        const outcome = await runUserDataMigration(oldDir, newDir);

        expect(outcome.migratedFiles).toEqual([SETTINGS_FILENAME]);
        expect(outcome.noticeMessage).toBe('Imported your settings from your previous version');
    });

    it('counts only recent projects whose paths still exist (the count the user will see)', async () => {
        const livingProject: string = join(base, 'living-project');
        await fs.mkdir(livingProject, {recursive: true});
        await fs.writeFile(join(oldDir, SETTINGS_FILENAME), JSON.stringify({userEmail: 'a@b.com'}));
        await fs.writeFile(join(oldDir, PROJECTS_FILENAME), JSON.stringify([
            {id: '1', path: livingProject, name: 'Living', type: 'folder', lastOpened: 1, voicetreeInitialized: true},
            {id: '2', path: join(base, 'deleted-project'), name: 'Gone', type: 'folder', lastOpened: 2, voicetreeInitialized: true},
        ]));

        const outcome = await runUserDataMigration(oldDir, newDir);

        expect([...outcome.migratedFiles].sort()).toEqual([PROJECTS_FILENAME, SETTINGS_FILENAME].sort());
        // 2 projects on disk, but one path no longer exists → notice says "1 recent project".
        expect(outcome.noticeMessage).toBe('Imported your settings & 1 recent project from your previous version');
    });

    it('returns an empty outcome with no notice when there is no old data', async () => {
        const outcome = await runUserDataMigration(oldDir, newDir);

        expect(outcome).toEqual({migratedFiles: [], noticeMessage: null});
    });
});
