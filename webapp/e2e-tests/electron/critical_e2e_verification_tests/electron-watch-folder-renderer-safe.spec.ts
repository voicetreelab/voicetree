import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const PROJECT_ROOT: string = path.resolve(process.cwd());

interface VtDebugException {
    readonly message: string;
}

interface DebugWindow extends Window {
    __vtDebug__?: {
        exceptions?: () => VtDebugException[];
    };
}

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page }>({
    electronApp: [async ({}, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-watch-folder-safe-'));

        const electronApp: ElectronApplication = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 15000,
        });

        await use(electronApp);

        await electronApp.close();
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }, { timeout: 30000 }],

    appWindow: [async ({ electronApp }, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({ timeout: 15000 });

        page.on('console', (msg) => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
        page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message));

        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => '__vtDebug__' in window, { timeout: 10000 });
        await page.waitForFunction(() => {
            const root = document.querySelector<HTMLElement>('#root');
            return Boolean(root && root.clientHeight > 0);
        }, { timeout: 10000 });

        await use(page);
    }, { timeout: 30000 }],
});

test('renderer bootstrap stays mountable when watchFolder is bundled', async ({ appWindow: page }) => {
    const rootMetrics: { clientHeight: number; childElementCount: number } = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('#root');
        return {
            clientHeight: root?.clientHeight ?? 0,
            childElementCount: root?.childElementCount ?? 0,
        };
    });

    expect(rootMetrics.clientHeight).toBeGreaterThan(0);
    expect(rootMetrics.childElementCount).toBeGreaterThan(0);

    const exceptions: VtDebugException[] = await page.evaluate(() =>
        (window as DebugWindow).__vtDebug__?.exceptions?.() ?? [],
    );

    expect(
        exceptions.some((entry) => entry.message.includes('process is not defined')),
    ).toBe(false);
    await expect(page.locator('text=Voicetree').first()).toBeVisible({ timeout: 10000 });
});
