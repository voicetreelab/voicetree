import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    type ExtendedWindow,
    createFolderTestVault,
} from '../folder-test-helpers';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
    projectRoot: string;
}>({
    projectRoot: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bf113-test-'));
        const projectRoot = await createFolderTestVault(tempDir);
        await use(projectRoot);
        await fs.rm(tempDir, { recursive: true, force: true });
    },

    electronApp: async ({ projectRoot }, use) => {
        const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bf113-ud-'));

        await fs.writeFile(path.join(tempUserData, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: projectRoot,
            vaultConfig: {
                [projectRoot]: {
                    writeFolder: projectRoot,
                    readPaths: []
                }
            }
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserData, 'projects.json'), JSON.stringify([{
            id: 'bf113-test',
            path: projectRoot,
            name: 'bf113-test-vault',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        }], null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserData}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '0',
                VOICETREE_PERSIST_STATE: '1'
            },
            timeout: 15000
        });

        await use(electronApp);

        const closeTask = (async (): Promise<void> => {
            try {
                const w = await electronApp.firstWindow();
                await w.evaluate(async () => {
                    const api = (window as unknown as ExtendedWindow).electronAPI;
                    if (api) await api.main.stopFileWatching();
                });
                await w.waitForTimeout(300);
            } catch {
                // Best-effort cleanup only.
            }

            await electronApp.close();
        })();

        const closed = await Promise.race([
            closeTask.then(() => true).catch(() => true),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!closed) {
            electronApp.process().kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>(resolve => setTimeout(resolve, 2000)),
            ]);
        }
        await fs.rm(tempUserData, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp, projectRoot }, use) => {
        const w = await electronApp.firstWindow({ timeout: 20000 });
        w.on('console', msg => {
            const t = msg.text();
            if (t.includes('folder') || t.includes('Folder') || t.includes('collapse') ||
                t.includes('synthetic') || t.includes('Error') || t.includes('error')) {
                console.log(`BROWSER [${msg.type()}]:`, t);
            }
        });
        w.on('pageerror', err => console.error('PAGE ERROR:', err.message));

        await w.waitForLoadState('domcontentloaded');

        const watchResult = await w.evaluate(async (folderPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return api.main.startFileWatching(folderPath);
        }, projectRoot);
        expect(watchResult.success, watchResult.error ?? 'startFileWatching failed').toBe(true);

        await w.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 30000 }
        );
        await w.waitForTimeout(3000);
        await use(w);
    }
});

export { expect, test };
