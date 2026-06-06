/**
 * Playwright fixture extension for the BF-332 persisted-resume specs.
 *
 * Only the fixture (`test`) is exported — the tmux / process / xterm helpers
 * live in the spec file directly so this module keeps the webapp/shell
 * boundary-width surface narrow (one new public symbol).
 */

import {_electron as electron} from '@playwright/test';
import type {ElectronApplication, Page} from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    PROJECT_ID,
    PROJECT_ROOT,
    buildElectronTestPath,
    createSurvivingAgentsProject,
    electronLinuxLaunchFlags,
    test as baseTest,
    type ExtendedWindow,
    type SurvivingAgentsProject,
} from '../content/electron-surviving-agents-helpers';

const STUB_CLAUDE_BODY: string = [
    '#!/usr/bin/env bash',
    '# E2E stub for the `claude` CLI used during the persisted-resume gate.',
    '#',
    '# - Stays alive so the spawned tmux pane and terminal-tree-node remain',
    '#   present long enough for the assertions to fire (and the byte round',
    '#   trip to drive traffic through).',
    '# - Deliberately does NOT `exec`, so `ps -o args=` on the pane pid keeps',
    '#   showing the original `claude --resume <native_session_id>` argv —',
    '#   the load-bearing proof that the recovery flow ran the resume command',
    '#   the BF-329 lazy native-session resolver produced.',
    '# - Spawns an interactive child bash for byte round-trip.',
    'bash --noprofile --norc -i',
    '',
].join('\n');

/**
 * Resume-spec fixture extension:
 *   - `project`            — fresh temp project dir (same shape as the shared helper).
 *   - `stubClaudeBinDir` — a temp dir containing a `claude` shim that the test
 *                          puts at the front of PATH for the Electron launch.
 *   - `electronApp`/`appWindow` — Electron launched with that PATH override.
 *
 * The shared helper's `electronApp` does not accept a PATH override, so this
 * file re-declares those fixtures rather than mutating the shared helper
 * (which would force every other surviving-agents spec to rebuild).
 */
export const test = baseTest.extend<{
    stubClaudeBinDir: string;
}>({
    project: [async ({}, use) => {
        const v: SurvivingAgentsProject = await createSurvivingAgentsProject();
        try {
            await use(v);
        } finally {
            await fs.rm(v.tempRoot, {recursive: true, force: true});
        }
    }, {scope: 'test', timeout: 10_000}],

    stubClaudeBinDir: [async ({project}, use) => {
        const dir: string = path.join(project.tempRoot, 'stub-bin');
        await fs.mkdir(dir, {recursive: true});
        const stubPath: string = path.join(dir, 'claude');
        await fs.writeFile(stubPath, STUB_CLAUDE_BODY, 'utf8');
        await fs.chmod(stubPath, 0o755);
        await use(dir);
    }, {scope: 'test', timeout: 10_000}],

    electronApp: [async ({project, stubClaudeBinDir}, use) => {
        const tempUserDataPath: string = project.voicetreeHomePath;
        await fs.mkdir(tempUserDataPath, {recursive: true});

        await fs.writeFile(path.join(tempUserDataPath, 'voicetree-config.json'), JSON.stringify({
            lastDirectory: project.projectRoot,
            projectConfig: {
                [project.projectRoot]: {
                    writeFolderPath: project.projectRoot,
                    readPaths: [],
                },
            },
        }, null, 2), 'utf8');

        await fs.writeFile(path.join(tempUserDataPath, 'projects.json'), JSON.stringify([{
            id: PROJECT_ID,
            path: project.projectRoot,
            name: PROJECT_ID,
            type: 'folder',
            lastOpened: Date.now(),
        }], null, 2), 'utf8');

        const electronApp: ElectronApplication = await electron.launch({
            args: [
                ...electronLinuxLaunchFlags(),
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                PATH: buildElectronTestPath([stubClaudeBinDir]),
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                VOICETREE_HOME_PATH: tempUserDataPath,
                VOICETREE_CLAUDE_PROJECTS_DIR: project.claudeProjectsRoot,
            },
            timeout: 15_000,
        });

        const electronProcess = electronApp.process();
        electronProcess?.stdout?.on('data', (chunk: Buffer) => {
            console.log(`[MAIN STDOUT] ${chunk.toString().trim()}`);
        });
        electronProcess?.stderr?.on('data', (chunk: Buffer) => {
            console.error(`[MAIN STDERR] ${chunk.toString().trim()}`);
        });

        await use(electronApp);

        const closeTask: Promise<void> = (async (): Promise<void> => {
            try {
                const window = await electronApp.firstWindow();
                await window.evaluate(async () => {
                    const api = (window as unknown as ExtendedWindow).hostAPI;
                    if (api) await api.main.stopFileWatching();
                });
                await window.waitForTimeout(200);
            } catch { /* best-effort cleanup */ }
            try { await electronApp.close(); } catch { /* ignore */ }
        })();
        const closed: boolean = await Promise.race([
            closeTask.then(() => true).catch(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000)),
        ]);
        if (!closed) {
            electronApp.process()?.kill('SIGKILL');
            await Promise.race([
                closeTask.catch(() => undefined),
                new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
            ]);
        }
    }, {scope: 'test', timeout: 30_000}],

    appWindow: [async ({electronApp}, use) => {
        const window: Page = await electronApp.firstWindow({timeout: 60_000});
        window.on('console', (msg) => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });
        window.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));

        await window.waitForLoadState('domcontentloaded');
        await window.waitForSelector('text=Recent Projects', {timeout: 15_000});
        await window.locator(`button:has-text("${PROJECT_ID}")`).first().click();

        await window.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            {timeout: 30_000},
        );

        await use(window);
    }, {scope: 'test', timeout: 60_000}],
});
