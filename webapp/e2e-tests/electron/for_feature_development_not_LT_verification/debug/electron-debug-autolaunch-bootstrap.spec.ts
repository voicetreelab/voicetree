import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { fileURLToPath } from 'url';

const WEBAPP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_PROJECT_PATH = path.join(WEBAPP_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
    cytoscapeInstance?: unknown;
    electronAPI?: {
        main: {
            getGraph: () => Promise<{ nodes: Record<string, unknown> }>;
            loadProjects: () => Promise<Array<{ path: string }>>;
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
        };
    };
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    electronApp: async ({}, use) => {
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-debug-autoload-'));

        const electronApp = await electron.launch({
            args: [
                path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
                VT_DEBUG_AUTOLAUNCHED: '1',
                VT_DEBUG_PROJECT_DIR: FIXTURE_PROJECT_PATH
            },
            timeout: 30000
        });

        await use(electronApp);

        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) {
                    await api.main.stopFileWatching();
                }
            });
            await window.waitForTimeout(300);
        } catch {
            // Window may already be gone.
        }

        await electronApp.close();
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 30000 });

        window.on('console', msg => {
            if (!msg.text().includes('Electron Security Warning')) {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            }
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');
        await use(window);
    }
});

test.describe('Debug Autolaunch Bootstrap', () => {
    test.setTimeout(60000);

    test('loads the debug project and bypasses project selection on boot', async ({ appWindow }) => {
        await appWindow.waitForFunction(
            () => !!(window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 15000 }
        );

        const bootState = await appWindow.evaluate(async () => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) {
                throw new Error('electronAPI not available');
            }

            const [graph, projects] = await Promise.all([
                api.main.getGraph(),
                api.main.loadProjects(),
            ]);

            return {
                bodyText: document.body.innerText,
                sidebarVisible: !!document.querySelector('.sidebar-wrapper'),
                projectPaths: projects.map(project => project.path),
                nodeCount: Object.keys(graph.nodes).length,
            };
        });

        expect(bootState.bodyText).not.toContain('Select a project to open');
        expect(bootState.sidebarVisible).toBe(true);
        expect(bootState.projectPaths).toContain(FIXTURE_PROJECT_PATH);
        expect(bootState.nodeCount).toBeGreaterThan(1);
    });
});
