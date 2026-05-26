import { expect } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pollForCytoscape, pollForCytoscapeNodes, robustElectronTeardown } from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';
import { launchProjectSelectionApp } from './electron-launch';
import { test } from './fixtures';
import { clickBackToProjectSelection, clickSavedProject, savedProjectButton } from './selectors';
import type { ExtendedWindow } from './types';

test.describe('Project Selection Screen E2E', () => {
    test('should show project selection screen on first launch', async ({ appWindow }) => {
        test.setTimeout(30000);
        console.log('=== TEST: Project selection screen shows on first launch ===');

        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });
        await appWindow.waitForSelector('text=Select a project to open', { timeout: 5000 });

        console.log('✓ Project selection screen title visible');

        const emptyStateVisible = await appWindow.locator('text=No projects yet').isVisible()
            .catch(() => false);
        const scanningVisible = await appWindow.locator('text=Scanning for projects').isVisible()
            .catch(() => false);
        const recentProjectsVisible = await appWindow.locator('text=Recent Projects').isVisible()
            .catch(() => false);
        const discoveredProjectsVisible = await appWindow.locator('text=Discovered Projects').isVisible()
            .catch(() => false);

        expect(emptyStateVisible || scanningVisible || recentProjectsVisible || discoveredProjectsVisible).toBe(true);
        console.log('✓ Project selection content state visible');

        const browseButton = appWindow.locator('button:has-text("Open existing folder")');
        await expect(browseButton).toBeVisible({ timeout: 5000 });
        console.log('✓ Open existing folder button visible');

        const hasCytoscape = await appWindow.evaluate(() => {
            return !!(window as ExtendedWindow).cytoscapeInstance;
        });
        expect(hasCytoscape).toBe(false);
        console.log('✓ No graph view loaded (correct for project selection screen)');

        console.log('✅ First launch test passed!');
    });

    test('should add project via browse and navigate to graph view', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);
        console.log('=== TEST: Add project via browse and navigate to graph ===');
        console.log('Test project path:', testProjectPath);

        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        await appWindow.evaluate(async (projectPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            const newProject = {
                id: crypto.randomUUID(),
                path: projectPath,
                name: projectPath.split('/').pop() ?? 'test-project',
                type: 'git' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: false
            };

            await api.main.saveProject(newProject);
        }, testProjectPath);

        console.log('✓ Saved test project via API');

        await appWindow.reload();
        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        await appWindow.waitForSelector('text=Recent Projects', { timeout: 5000 });
        console.log('✓ Recent Projects section visible');

        const projectName = testProjectPath.split('/').pop() ?? 'test-project';
        await savedProjectButton(appWindow, projectName);
        console.log('✓ Test project visible in list');

        await clickSavedProject(appWindow, projectName);
        console.log('✓ Clicked project to select');

        await pollForCytoscape(appWindow, 15000);
        console.log('✓ Graph view loaded');

        await pollForCytoscapeNodes(appWindow, 1, 15000);

        const nodeCount = await appWindow.evaluate(() => {
            const cy = (window as ExtendedWindow).cytoscapeInstance;
            return cy ? cy.nodes().length : 0;
        });
        console.log(`✓ Graph has ${nodeCount} nodes`);
        expect(nodeCount).toBeGreaterThan(0);

        const backButton = appWindow.locator('button[title="Back to project selection"]');
        await expect(backButton).toBeVisible({ timeout: 5000 });
        console.log('✓ Back button visible');

        console.log('✅ Add project and navigate test passed!');
    });

    test('should navigate back to project selection from graph view', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(45000);
        console.log('=== TEST: Navigate back to project selection ===');

        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        await appWindow.evaluate(async (projectPath: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            const newProject = {
                id: crypto.randomUUID(),
                path: projectPath,
                name: projectPath.split('/').pop() ?? 'test-project',
                type: 'git' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: false
            };
            await api.main.saveProject(newProject);
        }, testProjectPath);

        await appWindow.reload();
        await appWindow.waitForLoadState('domcontentloaded');
        await appWindow.waitForSelector('text=Recent Projects', { timeout: 10000 });

        const projectName = testProjectPath.split('/').pop() ?? 'test-project';
        await clickSavedProject(appWindow, projectName);

        await pollForCytoscape(appWindow, 15000);
        console.log('✓ In graph view');

        await clickBackToProjectSelection(appWindow);
        console.log('✓ Clicked back button');

        await appWindow.waitForSelector('text=Select a project to open', { timeout: 10000 });
        console.log('✓ Project selection screen visible');

        await appWindow.waitForSelector('text=Recent Projects', { timeout: 5000 });
        const projectStillVisible = await (await savedProjectButton(appWindow, projectName)).isVisible();
        expect(projectStillVisible).toBe(true);
        console.log('✓ Project still in saved list');

        console.log('✅ Navigate back test passed!');
    });

    test('should persist projects across app restart', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Projects persist across app restart ===');

        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-persist-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-persist-project-'));
        const projectPath = path.join(tempProjectPath, 'my-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(voicetreePath, { recursive: true });
        await fs.writeFile(path.join(voicetreePath, 'test.md'), '# Test\n\nPersistence test.');

        const savedProject = {
            id: 'persistence-test-id',
            path: projectPath,
            name: 'persistent-project',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        };
        await fs.writeFile(
            path.join(tempUserDataPath, 'projects.json'),
            JSON.stringify([savedProject], null, 2),
            'utf8'
        );
        console.log('✓ Created projects.json with saved project');

        try {
            const app1 = await launchProjectSelectionApp(tempUserDataPath);

            const window1 = await app1.firstWindow({ timeout: 15000 });
            await window1.waitForLoadState('domcontentloaded');
            await window1.waitForSelector('text=Voicetree', { timeout: 10000 });

            await window1.waitForSelector('text=Recent Projects', { timeout: 10000 });
            console.log('✓ First app shows Recent Projects');

            const projectVisibleInApp1 = await (await savedProjectButton(window1, 'persistent-project')).isVisible();
            expect(projectVisibleInApp1).toBe(true);
            console.log('✓ Project visible in first app instance');

            await robustElectronTeardown(app1);
            console.log('✓ Closed first app instance');

            await new Promise(resolve => setTimeout(resolve, 500));

            const app2 = await launchProjectSelectionApp(tempUserDataPath);

            const window2 = await app2.firstWindow({ timeout: 15000 });
            await window2.waitForLoadState('domcontentloaded');
            await window2.waitForSelector('text=Voicetree', { timeout: 10000 });

            await window2.waitForSelector('text=Recent Projects', { timeout: 10000 });
            console.log('✓ Second app shows Recent Projects');

            const projectVisible = await (await savedProjectButton(window2, 'persistent-project')).isVisible();
            expect(projectVisible).toBe(true);
            console.log('✓ Project persisted across restart');

            await robustElectronTeardown(app2);
            console.log('✅ Persistence test passed!');
        } finally {
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });
});
