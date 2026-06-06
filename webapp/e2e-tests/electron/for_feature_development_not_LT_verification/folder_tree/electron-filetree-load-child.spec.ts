import {
    test,
    expect,
    folderRow,
    expandFolderIfNeeded,
    type ExtendedWindow,
} from './electron-filetree-load-child.fixtures';
import { clickVisibleElementCenter, openFolderTreeSidebar } from './folder-spec-e2e-helpers';

test('loads a nested child folder from the file tree sidebar', async ({ appWindow, fixture }) => {
    await openFolderTreeSidebar(appWindow);
    await expandFolderIfNeeded(appWindow, fixture.projectPath, fixture.parentPath);
    await expandFolderIfNeeded(appWindow, fixture.parentPath, fixture.childPath);

    const rendererErrors: string[] = [];
    appWindow.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (text.includes('Not Found') || text.includes('GraphDbClientError')) {
            rendererErrors.push(text);
        }
    });
    appWindow.on('pageerror', (error) => {
        const text = error.message;
        if (text.includes('Not Found') || text.includes('GraphDbClientError')) {
            rendererErrors.push(text);
        }
    });

    const childRow = folderRow(appWindow, fixture.childPath);
    await expect(childRow.locator('.folder-tree-load-indicator.not-loaded')).toBeVisible();
    await clickVisibleElementCenter(appWindow, childRow.locator('.folder-tree-load-indicator'));

    await expect(childRow.locator('.folder-tree-load-indicator.loaded')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
        return await appWindow.evaluate((notePath: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            return cy?.nodes().some((node) => node.id() === notePath) ?? false;
        }, fixture.notePath);
    }, {
        message: 'Waiting for child folder note to appear in projected graph',
        timeout: 15000,
        intervals: [500, 1000, 2000],
    }).toBe(true);

    expect(rendererErrors).toEqual([]);
});
