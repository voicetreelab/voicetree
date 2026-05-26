import { expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pollForCytoscape, pollForCytoscapeNodes, robustElectronTeardown, safeStopFileWatching } from '@e2e/electron/critical_e2e_verification_tests/electron-smoke-helpers';
import { launchProjectSelectionApp } from './electron-launch';
import { test } from './fixtures';
import { clickBackToProjectSelection, clickSavedProject, savedProjectButton } from './selectors';
import type { ExtendedWindow } from './types';

test.describe('Watched Folder Panel Regression', () => {
    test('should show watched folder panel for fresh project without config', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Watched folder panel for FRESH project (no config) ===');

        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fresh-test-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fresh-test-project-'));
        const projectPath = path.join(tempProjectPath, 'fresh-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        try {
            await fs.mkdir(voicetreePath, { recursive: true });
            await fs.writeFile(
                path.join(voicetreePath, 'test-node.md'),
                '# Fresh Test Node\n\nThis is a fresh project with no existing config.'
            );

            const savedProject = {
                id: 'fresh-project-id',
                path: projectPath,
                name: 'fresh-project',
                type: 'folder' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: true
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify([savedProject], null, 2),
                'utf8'
            );
            console.log('✓ Created fresh project (no voicetree-config.json)');

            const electronApp = await launchProjectSelectionApp(tempUserDataPath);

            const appWindow = await electronApp.firstWindow({ timeout: 15000 });
            appWindow.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()));
            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

            await clickSavedProject(appWindow, 'fresh-project');
            console.log('✓ Clicked fresh project');

            await pollForCytoscapeNodes(appWindow, 1, 15000);
            console.log('✓ Graph loaded');

            try {
                await appWindow.locator('button[title*="Project root"]').waitFor({ state: 'visible', timeout: 10000 });
                console.log('✓ Folder panel appeared');
            } catch {
                console.log('✗ Folder panel did NOT appear within 10s');
            }

            const folderNameVisible = await appWindow.locator('button[title*="Project root"]').isVisible();
            const vaultSelectorVisible = await appWindow.locator('button[title*="Write Path"]').isVisible();
            const watchStatus = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getWatchStatus() : null;
            });
            const vaultPaths = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getVaultPaths() : null;
            });

            const debugInfo = JSON.stringify({ folderNameVisible, vaultSelectorVisible, watchStatus, vaultPaths }, null, 2);
            expect(folderNameVisible, `Fresh project panel check - ${debugInfo}`).toBe(true);
            expect(vaultSelectorVisible, `Fresh project vault selector - ${debugInfo}`).toBe(true);

            console.log('✅ Fresh project shows panel correctly');

            await safeStopFileWatching(electronApp);
            await robustElectronTeardown(electronApp);
        } finally {
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });

    test('should show watched folder panel for projects with existing config', async () => {
        test.setTimeout(60000);
        console.log('=== TEST: Watched folder panel visible for projects with existing config ===');

        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-panel-test-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-panel-test-project-'));
        const projectPath = path.join(tempProjectPath, 'existing-config-project');
        const voicetreePath = path.join(projectPath, 'voicetree');

        try {
            await fs.mkdir(projectPath, { recursive: true });
            await fs.mkdir(voicetreePath, { recursive: true });
            await fs.writeFile(
                path.join(voicetreePath, 'test-node.md'),
                '# Test Node\n\nThis is a test file in a project with existing config.'
            );
            console.log('✓ Created project structure at:', projectPath);

            const voicetreeConfig = {
                lastDirectory: projectPath,
                vaultConfig: {
                    [projectPath]: {
                        writeFolder: voicetreePath,
                        readPaths: []
                    }
                }
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                JSON.stringify(voicetreeConfig, null, 2),
                'utf8'
            );
            console.log('✓ Created voicetree-config.json with existing vaultConfig');

            const savedProject = {
                id: 'existing-config-test-id',
                path: projectPath,
                name: 'existing-config-project',
                type: 'folder' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: true
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify([savedProject], null, 2),
                'utf8'
            );
            console.log('✓ Created projects.json with saved project');

            const electronApp = await launchProjectSelectionApp(tempUserDataPath);
            const appWindow = await electronApp.firstWindow({ timeout: 15000 });

            appWindow.on('console', msg => {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            });

            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });
            console.log('✓ App launched');

            let graphLoadedViaAutoLoad = false;
            try {
                await pollForCytoscape(appWindow, 3000);
                graphLoadedViaAutoLoad = true;
                console.log('✓ Graph auto-loaded via lastDirectory config');
            } catch {
                // Not auto-loaded; go through project selection.
            }

            if (!graphLoadedViaAutoLoad) {
                await savedProjectButton(appWindow, 'existing-config-project');
                console.log('✓ Project visible in Recent Projects');

                await clickSavedProject(appWindow, 'existing-config-project');
                console.log('✓ Clicked project to open');
            }

            await pollForCytoscape(appWindow, 15000);
            console.log('✓ Graph view loaded');

            await pollForCytoscapeNodes(appWindow, 1, 15000);
            const nodeCount = await appWindow.evaluate(() => {
                const cy = (window as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
            console.log(`✓ Graph has ${nodeCount} nodes`);

            const backButton = appWindow.locator('button[title="Back to project selection"]');
            await expect(backButton).toBeVisible({ timeout: 5000 });
            console.log('✓ Back button visible');

            const folderNameButton = appWindow.locator('button[title*="Project root"]');
            const isFolderNameVisible = await folderNameButton.isVisible({ timeout: 5000 }).catch(() => false);
            console.log('Folder name button visible:', isFolderNameVisible);

            const vaultSelector = appWindow.locator('button[title*="Write Path"]');
            const isVaultSelectorVisible = await vaultSelector.isVisible({ timeout: 5000 }).catch(() => false);
            console.log('Vault selector visible:', isVaultSelectorVisible);

            const watchStatus = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getWatchStatus() : null;
            });
            console.log('Watch status:', watchStatus);

            const vaultPaths = await appWindow.evaluate(async () => {
                const api = (window as ExtendedWindow).electronAPI;
                return api ? await api.main.getVaultPaths() : null;
            });
            console.log('Vault paths:', vaultPaths);

            if (!isFolderNameVisible || !isVaultSelectorVisible) {
                await appWindow.screenshot({
                    path: path.join(tempUserDataPath, 'watched-folder-panel-bug.png')
                });
                console.log('Screenshot saved to:', path.join(tempUserDataPath, 'watched-folder-panel-bug.png'));
            }

            expect(isFolderNameVisible).toBe(true);
            expect(isVaultSelectorVisible).toBe(true);
            expect(watchStatus?.directory).toBe(projectPath);
            expect(vaultPaths).not.toBeNull();
            expect(vaultPaths!.length).toBeGreaterThan(0);

            console.log('✅ Watched folder panel fully visible for project with existing config!');

            await safeStopFileWatching(electronApp);
            await robustElectronTeardown(electronApp);
        } finally {
            await fs.rm(tempUserDataPath, { recursive: true, force: true });
            await fs.rm(tempProjectPath, { recursive: true, force: true });
        }
    });

    test('should show same panel behavior for new vs existing config projects', async () => {
        test.setTimeout(90000);
        console.log('=== TEST: Compare panel visibility - new vs existing config ===');

        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-compare-userdata-'));
        const tempProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-compare-project-'));

        const projectWithConfig = path.join(tempProjectPath, 'with-config');
        const projectWithoutConfig = path.join(tempProjectPath, 'without-config');
        const voicetreeWithConfig = path.join(projectWithConfig, 'voicetree');
        const voicetreeWithoutConfig = path.join(projectWithoutConfig, 'voicetree');
        let electronApp: ElectronApplication | undefined;

        try {
            await fs.mkdir(voicetreeWithConfig, { recursive: true });
            await fs.mkdir(voicetreeWithoutConfig, { recursive: true });
            await fs.writeFile(
                path.join(voicetreeWithConfig, 'test.md'),
                '# Test With Config'
            );
            await fs.writeFile(
                path.join(voicetreeWithoutConfig, 'test.md'),
                '# Test Without Config'
            );

            const voicetreeConfig = {
                vaultConfig: {
                    [projectWithConfig]: {
                        writeFolder: voicetreeWithConfig,
                        readPaths: []
                    }
                }
            };
            await fs.writeFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                JSON.stringify(voicetreeConfig, null, 2),
                'utf8'
            );

            const savedProjects = [
                {
                    id: 'with-config-id',
                    path: projectWithConfig,
                    name: 'with-config',
                    type: 'folder' as const,
                    lastOpened: Date.now(),
                    voicetreeInitialized: true
                },
                {
                    id: 'without-config-id',
                    path: projectWithoutConfig,
                    name: 'without-config',
                    type: 'folder' as const,
                    lastOpened: Date.now() - 1000,
                    voicetreeInitialized: true
                }
            ];
            await fs.writeFile(
                path.join(tempUserDataPath, 'projects.json'),
                JSON.stringify(savedProjects, null, 2),
                'utf8'
            );

            console.log('✓ Created two projects: one with existing config, one without');

            const checkPanelVisibility = async (appWindow: Page, projectName: string, tempDir: string) => {
                console.log(`[${projectName}] About to click project...`);
                await clickSavedProject(appWindow, projectName);
                console.log(`[${projectName}] Clicked, waiting for graph...`);

                await pollForCytoscapeNodes(appWindow, 1, 15000);
                console.log(`[${projectName}] Graph loaded with nodes`);

                try {
                    await appWindow.locator('button[title*="Project root"]').waitFor({ state: 'visible', timeout: 10000 });
                    console.log(`[${projectName}] Folder panel became visible`);
                } catch {
                    console.log(`[${projectName}] WARNING: Folder panel did NOT become visible within 10s`);
                }

                const folderNameVisible = await appWindow.locator('button[title*="Project root"]').isVisible().catch(() => false);
                const vaultSelectorVisible = await appWindow.locator('button[title*="Write Path"]').isVisible().catch(() => false);
                const watchStatus = await appWindow.evaluate(async () => {
                    const api = (window as ExtendedWindow).electronAPI;
                    return api ? await api.main.getWatchStatus() : null;
                });
                const vaultPaths = await appWindow.evaluate(async () => {
                    const api = (window as ExtendedWindow).electronAPI;
                    return api ? await api.main.getVaultPaths() : null;
                });

                const screenshotPath = path.join(tempDir, `panel-check-${projectName}.png`);
                await appWindow.screenshot({ path: screenshotPath, timeout: 5000 })
                    .then(() => console.log(`[${projectName}] Screenshot saved to: ${screenshotPath}`))
                    .catch(error => console.log(`[${projectName}] Screenshot skipped: ${String(error)}`));

                return {
                    folderNameVisible,
                    vaultSelectorVisible,
                    isWatching: watchStatus?.isWatching,
                    directory: watchStatus?.directory,
                    vaultPathsCount: vaultPaths?.length ?? 0
                };
            };

            electronApp = await launchProjectSelectionApp(tempUserDataPath);
            const appWindow = await electronApp.firstWindow({ timeout: 15000 });
            appWindow.on('console', msg => {
                console.log(`BROWSER [${msg.type()}]:`, msg.text());
            });
            await appWindow.waitForLoadState('domcontentloaded');
            await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

            console.log('\n--- Testing project WITH existing config ---');
            const resultWithConfig = await checkPanelVisibility(appWindow, 'with-config', tempUserDataPath);
            console.log('Result (with config):', resultWithConfig);

            await clickBackToProjectSelection(appWindow);
            await appWindow.waitForSelector('text=Select a project to open', { timeout: 10000 });

            console.log('\n--- Testing project WITHOUT existing config ---');
            const resultWithoutConfig = await checkPanelVisibility(appWindow, 'without-config', tempUserDataPath);
            console.log('Result (without config):', resultWithoutConfig);

            console.log('\n--- Comparison ---');
            console.log('With config - folder visible:', resultWithConfig.folderNameVisible);
            console.log('Without config - folder visible:', resultWithoutConfig.folderNameVisible);
            console.log('With config - vault selector visible:', resultWithConfig.vaultSelectorVisible);
            console.log('Without config - vault selector visible:', resultWithoutConfig.vaultSelectorVisible);
            console.log('With config - watch status:', resultWithConfig.isWatching, resultWithConfig.directory);
            console.log('Without config - watch status:', resultWithoutConfig.isWatching, resultWithoutConfig.directory);
            console.log('With config - vault paths count:', resultWithConfig.vaultPathsCount);
            console.log('Without config - vault paths count:', resultWithoutConfig.vaultPathsCount);

            const configContent = await fs.readFile(
                path.join(tempUserDataPath, 'voicetree-config.json'),
                'utf8'
            );
            console.log('voicetree-config.json after both opens:', configContent);

            const debugInfo = JSON.stringify({
                withConfig: resultWithConfig,
                withoutConfig: resultWithoutConfig,
                config: JSON.parse(configContent)
            }, null, 2);

            expect(resultWithConfig.folderNameVisible, `WITH CONFIG - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithConfig.vaultSelectorVisible, `WITH CONFIG selector - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithoutConfig.folderNameVisible, `WITHOUT CONFIG - Debug: ${debugInfo}`).toBe(true);
            expect(resultWithoutConfig.vaultSelectorVisible, `WITHOUT CONFIG selector - Debug: ${debugInfo}`).toBe(true);

            console.log('✅ Both project types show watched folder panel correctly!');
        } finally {
            if (electronApp) {
                await safeStopFileWatching(electronApp).catch(error => {
                    console.log(`safeStopFileWatching failed during cleanup: ${String(error)}`);
                });
                await robustElectronTeardown(electronApp).catch(error => {
                    console.log(`robustElectronTeardown failed during cleanup: ${String(error)}`);
                });
            }
            await fs.rm(tempUserDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            await fs.rm(tempProjectPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
