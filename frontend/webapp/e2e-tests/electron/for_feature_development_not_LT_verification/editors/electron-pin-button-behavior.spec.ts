/**
 * BEHAVIORAL SPEC: Pin Button Behavior in Traffic Lights
 *
 * Bug 1: Pinned editors inconsistently appear in recent vs pinned sections
 * Bug 2: Pinning a hover editor doesn't convert it to an anchored permanent editor
 *
 * Expected behaviors:
 * 1. When a node is pinned via traffic light pin button, it MUST appear in pinned section (left)
 * 2. When a node is unpinned, it MUST move back to recent section (right)
 * 3. Pinning a hover editor MUST:
 *    a) Close the hover editor
 *    b) Create an anchored editor with shadow node
 *    c) Add node to pinned editors state
 *    d) Show node in pinned section of tabs bar
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

// Type definition for browser window with cytoscape
interface ExtendedWindow extends Window {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: {
        main?: {
            stopFileWatching?: () => Promise<{ success: boolean; error?: string }>;
            getGraph?: () => Promise<{ nodes: Record<string, unknown> } | null>;
        };
    };
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    electronApp: async ({}, use) => {
        // Create a temporary userData directory for this test
        const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-pin-test-'));

        // Write the config file to auto-load the test vault
        const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
        await fs.writeFile(configPath, JSON.stringify({ lastDirectory: FIXTURE_VAULT_PATH }, null, 2), 'utf8');

        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`
            ],
            env: { ...process.env, NODE_ENV: 'test', HEADLESS_TEST: '1', MINIMIZE_TEST: '1' },
            timeout: 10000
        });

        await use(electronApp);

        // Graceful shutdown
        try {
            const page = await electronApp.firstWindow();
            await page.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api?.main?.stopFileWatching) {
                    await api.main.stopFileWatching();
                }
            });
            await page.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();
        await fs.rm(tempUserDataPath, { recursive: true, force: true });
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow();

        window.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]:`, msg.text());
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded', { timeout: 10000 });
        await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });

        await use(window);
    }
});

test.describe('Pin Button Behavior - Bug Reproduction Tests', () => {

    // SKIP: Hover editor creation has a pre-existing bug - see electron-command-hover-editor.spec.ts
    // The hover editor feature doesn't work in tests due to async graph loading issues
    test.skip('BUG: pinning a hover editor should create an anchored permanent editor', async ({ appWindow }) => {
        // Wait for graph to load
        await appWindow.waitForTimeout(500);

        // Get an existing markdown node
        const nodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
            return node.id();
        });

        console.log('[TEST] Testing pin on node:', nodeId);

        // Count shadow nodes before
        const shadowNodeCountBefore = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            return cy.nodes('[?isShadowNode]').length;
        });
        console.log('[TEST] Shadow nodes before hover:', shadowNodeCountBefore);

        // Open hover editor by emitting mouseover event on the node
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.$(`#${CSS.escape(id)}`);
            node.emit('mouseover');
        }, nodeId);
        await appWindow.waitForTimeout(500);

        // Take screenshot before pin
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/pin-button-before-pin-hover.png',
            fullPage: true
        });

        // Verify hover editor exists (no shadow node yet)
        const hoverEditorExists = await appWindow.evaluate(() => {
            const editors = document.querySelectorAll('[id^="window-editor-"]');
            return editors.length;
        });
        console.log('[TEST] Hover editor count:', hoverEditorExists);
        expect(hoverEditorExists).toBeGreaterThan(0);

        // Verify NO shadow node for hover editor
        const shadowNodeCountAfterHover = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            return cy.nodes('[?isShadowNode]').length;
        });
        console.log('[TEST] Shadow nodes after hover:', shadowNodeCountAfterHover);
        expect(shadowNodeCountAfterHover).toBe(shadowNodeCountBefore); // No new shadow nodes for hover

        // Find and click the pin button on the hover editor
        const pinButtonClicked = await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            if (!pinButton) return false;
            pinButton.click();
            return true;
        });
        expect(pinButtonClicked).toBe(true);
        await appWindow.waitForTimeout(600); // Wait for async anchor operation

        // Take screenshot after pin
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/pin-button-after-pin-hover.png',
            fullPage: true
        });

        // BUG CHECK: After pinning, there should be a shadow node created
        // This indicates the hover editor was converted to an anchored editor
        const shadowNodeCountAfterPin = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            return cy.nodes('[?isShadowNode]').length;
        });
        console.log('[TEST] Shadow nodes after pin:', shadowNodeCountAfterPin);

        // EXPECTED: shadowNodeCountAfterPin === shadowNodeCountBefore + 1
        // This test currently FAILS because pinning hover doesn't create anchored editor
        expect(shadowNodeCountAfterPin).toBe(shadowNodeCountBefore + 1);

        // Verify the node is now in pinned state
        const isPinned = await appWindow.evaluate((id: string) => {
            // Access EditorStore via module scope
            const pinnedEditors = (window as unknown as { EditorStore?: { getPinnedEditors: () => Set<string> } }).EditorStore?.getPinnedEditors();
            return pinnedEditors?.has(id) ?? false;
        }, nodeId);
        console.log('[TEST] Is node pinned:', isPinned);
        expect(isPinned).toBe(true);
    });

    test('BUG: pinned node should appear in pinned tabs section', async ({ appWindow }) => {
        // Wait for graph to load
        await appWindow.waitForTimeout(500);

        // Get an existing markdown node
        const nodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
            return node.id();
        });

        // Click on the node to open permanent editor
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.$(`#${CSS.escape(id)}`);
            // Emit tap event to open permanent editor
            node.emit('tap');
        }, nodeId);

        // Wait for editor window to appear
        await appWindow.waitForSelector('[id^="window-editor-"]', { timeout: 5000 });
        // Wait for pin button to be created
        await appWindow.waitForSelector('.cy-floating-window-pin', { timeout: 3000 });

        // Take screenshot before pin
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/pin-button-tabs-before-pin.png',
            fullPage: true
        });

        // Check pinned section is empty initially
        const pinnedSectionBefore = await appWindow.evaluate(() => {
            const pinnedSection = document.querySelector('[data-testid="pinned-tabs-section"]');
            return pinnedSection?.children.length ?? 0;
        });
        console.log('[TEST] Pinned section children before:', pinnedSectionBefore);

        // Find and click the pin button
        const pinButtonClicked = await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            console.log('[DEBUG] Editor found:', !!editor, 'Pin button found:', !!pinButton);
            if (!pinButton) return false;
            pinButton.click();
            return true;
        });
        expect(pinButtonClicked).toBe(true);
        await appWindow.waitForTimeout(300);

        // Take screenshot after pin
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/pin-button-tabs-after-pin.png',
            fullPage: true
        });

        // BUG CHECK: After pinning, the node should appear in pinned section
        const pinnedSectionAfter = await appWindow.evaluate(() => {
            const pinnedSection = document.querySelector('[data-testid="pinned-tabs-section"]');
            return {
                childCount: pinnedSection?.children.length ?? 0,
                innerHTML: pinnedSection?.innerHTML ?? ''
            };
        });
        console.log('[TEST] Pinned section children after:', pinnedSectionAfter.childCount);
        console.log('[TEST] Pinned section HTML:', pinnedSectionAfter.innerHTML);

        // EXPECTED: pinnedSectionAfter.childCount === pinnedSectionBefore + 1
        // This test may FAIL if the tabs bar doesn't re-render after pin state change
        expect(pinnedSectionAfter.childCount).toBe(pinnedSectionBefore + 1);

        // Verify the pinned tab has the correct node ID
        const pinnedTabNodeId = await appWindow.evaluate((_expectedId: string) => {
            const pinnedSection = document.querySelector('[data-testid="pinned-tabs-section"]');
            const pinnedTab = pinnedSection?.querySelector('[data-node-id]');
            return pinnedTab?.getAttribute('data-node-id') ?? null;
        }, nodeId);
        console.log('[TEST] Pinned tab node ID:', pinnedTabNodeId);
        expect(pinnedTabNodeId).toBe(nodeId);
    });

    test('BUG: unpinning should move node from pinned to recent section', async ({ appWindow }) => {
        // Wait for graph to load
        await appWindow.waitForTimeout(500);

        // Get an existing markdown node
        const nodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
            return node.id();
        });

        // Click node to open editor
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.$(`#${CSS.escape(id)}`);
            node.emit('tap');
        }, nodeId);

        // Wait for editor and pin button
        await appWindow.waitForSelector('[id^="window-editor-"]', { timeout: 5000 });
        await appWindow.waitForSelector('.cy-floating-window-pin', { timeout: 3000 });

        // Pin the editor
        await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            pinButton?.click();
        });
        await appWindow.waitForTimeout(300);

        // Verify node is in pinned section
        const pinnedCountAfterPin = await appWindow.evaluate(() => {
            const pinnedSection = document.querySelector('[data-testid="pinned-tabs-section"]');
            return pinnedSection?.children.length ?? 0;
        });
        console.log('[TEST] Pinned count after pin:', pinnedCountAfterPin);

        // Now unpin by clicking pin button again
        await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            pinButton?.click();
        });
        await appWindow.waitForTimeout(300);

        // Take screenshot after unpin
        await appWindow.screenshot({
            path: 'e2e-tests/screenshots/pin-button-after-unpin.png',
            fullPage: true
        });

        // Verify node moved from pinned to recent
        const sectionsAfterUnpin = await appWindow.evaluate(() => {
            const pinnedSection = document.querySelector('[data-testid="pinned-tabs-section"]');
            const recentSection = document.querySelector('.recent-tabs-scroll');
            return {
                pinnedCount: pinnedSection?.children.length ?? 0,
                recentCount: recentSection?.children.length ?? 0
            };
        });
        console.log('[TEST] After unpin - pinned:', sectionsAfterUnpin.pinnedCount, 'recent:', sectionsAfterUnpin.recentCount);

        // Pinned section should be empty after unpin
        expect(sectionsAfterUnpin.pinnedCount).toBe(pinnedCountAfterPin - 1);
    });

    test('verify pin button icon changes state correctly', async ({ appWindow }) => {
        // Wait for graph to load
        await appWindow.waitForTimeout(500);

        // Get an existing markdown node
        const nodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.nodes().filter((n: { id: () => string }) => n.id().endsWith('.md')).first();
            return node.id();
        });

        // Click node to open editor
        await appWindow.evaluate((id: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape instance not found');
            const node = cy.$(`#${CSS.escape(id)}`);
            node.emit('tap');
        }, nodeId);

        // Wait for editor and pin button
        await appWindow.waitForSelector('[id^="window-editor-"]', { timeout: 5000 });
        await appWindow.waitForSelector('.cy-floating-window-pin', { timeout: 3000 });

        // Get initial pin button title (should be "Pin Editor" when unpinned)
        const initialTitle = await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            return pinButton?.title ?? '';
        });
        console.log('[TEST] Initial pin button title:', initialTitle);
        expect(initialTitle).toBe('Pin Editor');

        // Click pin button
        await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            pinButton?.click();
        });
        await appWindow.waitForTimeout(300);

        // Get title after pin (should be "Unpin" when pinned)
        const titleAfterPin = await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            return pinButton?.title ?? '';
        });
        console.log('[TEST] Pin button title after pin:', titleAfterPin);
        expect(titleAfterPin).toBe('Unpin (allow auto-close)');

        // Click pin button again to unpin
        await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            pinButton?.click();
        });
        await appWindow.waitForTimeout(300);

        // Get title after unpin (should be back to "Pin Editor")
        const titleAfterUnpin = await appWindow.evaluate(() => {
            const editor = document.querySelector('[id^="window-editor-"]');
            const pinButton = editor?.querySelector('.cy-floating-window-pin') as HTMLButtonElement;
            return pinButton?.title ?? '';
        });
        console.log('[TEST] Pin button title after unpin:', titleAfterUnpin);
        expect(titleAfterUnpin).toBe('Pin Editor');
    });
});
