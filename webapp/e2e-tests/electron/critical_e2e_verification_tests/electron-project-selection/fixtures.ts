import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { robustElectronTeardown, resolveGraphDaemonNodeBin, safeStopFileWatching } from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';
import { CI_FLAGS, PROJECT_ROOT } from './paths';

export const test = base.extend<{
    testProjectPath: string;
    tempUserDataPath: string;
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    testProjectPath: async ({}, use) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-project-selection-'));
        const projectPath = path.join(tempDir, 'test-project');
        const gitPath = path.join(projectPath, '.git');
        const voicetreePath = path.join(projectPath, 'voicetree');

        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(gitPath, { recursive: true });
        await fs.mkdir(voicetreePath, { recursive: true });

        await fs.writeFile(path.join(gitPath, 'HEAD'), 'ref: refs/heads/main\n');
        await fs.writeFile(
            path.join(voicetreePath, 'test.md'),
            '# Test Node\n\nThis is a test markdown file.'
        );

        await use(projectPath);

        await fs.rm(tempDir, { recursive: true, force: true });
    },

    tempUserDataPath: async ({}, use) => {
        const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-project-selection-userdata-'));
        await use(tempPath);
        await fs.rm(tempPath, { recursive: true, force: true });
    },

    electronApp: async ({ tempUserDataPath }, use) => {
        const electronApp = await electron.launch({
            args: [
                ...CI_FLAGS,
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
            },
            timeout: 15000
        });

        await use(electronApp);

        await safeStopFileWatching(electronApp);
        await robustElectronTeardown(electronApp);
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]:`, msg.text());
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        await use(window);
    }
});
