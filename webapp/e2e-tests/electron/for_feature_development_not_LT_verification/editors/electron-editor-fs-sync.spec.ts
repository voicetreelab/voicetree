/**
 * BEHAVIORAL SPEC: Editor FS Sync (Bidirectional)
 *
 * Tests whether open editors (card shells) sync with external filesystem changes.
 * The card shell system mounts CM6 lazily; this test verifies that:
 *
 * 1. Pinned editors (opened via tap → pinCardShell) update when the underlying
 *    file changes on disk (external process, agent, etc.)
 *
 * ARCHITECTURE:
 * FS change → chokidar → handleFSEventWithStateAndUISides → applyAndBroadcast
 *   → broadcastGraphDeltaToUI (updates Cy node data)
 *   → uiAPI.updateFloatingEditorsFromExternal (updates CM6 via EditorSync)
 *
 * EditorSync.updateFloatingEditors only updates editors registered in EditorStore.
 * Card shells are only added to EditorStore when PINNED (via pinShell → addEditor).
 * Non-pinned card shells (hover state with CM6 mounted) are NOT in EditorStore
 * and therefore do NOT receive FS sync updates — this is a known gap.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EditorView } from '@codemirror/view';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    };
  };
}

interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fs-sync-test-'));

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: FIXTURE_VAULT_PATH,
      suffixes: {
        [FIXTURE_VAULT_PATH]: '' // Empty suffix = use directory directly
      }
    }, null, 2), 'utf8');

    // Also create projects.json so renderer can match watching-started to a known project
    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(projectsPath, JSON.stringify([{
      id: 'test-fs-sync',
      path: FIXTURE_VAULT_PATH,
      name: 'example_small',
      type: 'folder',
      lastOpened: Date.now(),
      voicetreeInitialized: true
    }], null, 2), 'utf8');

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1'
      },
      timeout: 10000
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) await api.main.stopFileWatching();
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 15000 });

    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await page.waitForLoadState('domcontentloaded');

    // Click the project in the selection screen to open it
    // The project appears as a button with the fixture path text
    const projectButton = page.locator('button', { hasText: 'example_small' });
    await projectButton.waitFor({ timeout: 10000 });
    await projectButton.click();

    // Wait for graph view to mount and cytoscape to be ready
    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 45000 }]
});

test.describe('Editor FS Sync', () => {
  test.afterEach(async ({ appWindow }) => {
    try {
      await appWindow.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) await api.main.stopFileWatching();
      });
      await appWindow.waitForTimeout(200);
    } catch {
      // Window might be closed
    }
  });

  test('pinned editor should sync when file changes externally', async ({ appWindow }) => {
    test.setTimeout(60000);

    // Wait for graph to load nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, {
      message: 'Waiting for graph to load nodes',
      timeout: 15000
    }).toBeGreaterThan(0);

    // Find the target node: "Ongoing development for the VoiceTree website."
    // This is the heading of 1_VoiceTree_Website_Development_and_Node_Display_Bug.md
    const TARGET_LABEL = 'Ongoing development for the VoiceTree website.';

    const nodeId = await appWindow.evaluate((label) => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');

      const nodes = cy.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.data('label') === label) {
          return node.id();
        }
      }

      // Fallback: list available labels for debugging
      const available: string[] = [];
      for (let i = 0; i < Math.min(10, nodes.length); i++) {
        available.push(nodes[i].data('label') as string);
      }
      throw new Error(`Node "${label}" not found. Available: ${available.join(', ')}`);
    }, TARGET_LABEL);

    console.log(`Found node: "${TARGET_LABEL}" → ${nodeId}`);

    // Resolve file path
    const testFilePath = path.isAbsolute(nodeId)
      ? nodeId
      : path.join(FIXTURE_VAULT_PATH, nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`);

    // Read original content for restoration
    const originalContent = await fs.readFile(testFilePath, 'utf-8');
    console.log('Original file content length:', originalContent.length);

    try {
      // Open editor by tapping the node (creates a pinned card shell)
      await appWindow.evaluate((nId) => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.getElementById(nId);
        if (node.length === 0) throw new Error(`Node ${nId} not found`);
        node.trigger('tap');
      }, nodeId);

      // Wait for editor window to appear
      const editorWindowId = `window-${nodeId}-editor`;
      await expect.poll(async () => {
        return appWindow.evaluate((winId) => {
          return document.getElementById(winId) !== null;
        }, editorWindowId);
      }, {
        message: 'Waiting for pinned editor to appear',
        timeout: 10000
      }).toBe(true);

      // Wait for CodeMirror to render
      const escapedId = editorWindowId.replace(/[./]/g, '\\$&');
      await appWindow.waitForSelector(`#${escapedId} .cm-editor`, { timeout: 5000 });

      // Read the initial editor content
      const initialContent = await appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const el = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
        if (!el) return null;
        const cmView = (el as CodeMirrorElement).cmView?.view;
        return cmView ? cmView.state.doc.toString() : null;
      }, editorWindowId);

      expect(initialContent).not.toBeNull();
      console.log('Initial editor content:', initialContent!.substring(0, 80) + '...');

      // Write new content externally (simulating an agent or external editor)
      const UNIQUE_MARKER = 'EXTERNAL_FS_SYNC_TEST_' + Date.now();
      const externalContent = `---\n---\n### Ongoing development for the VoiceTree website.\n\n**${UNIQUE_MARKER}** - Written by e2e test to verify editor syncs with filesystem changes.\n\nThis content should appear in the open editor automatically.`;
      await fs.writeFile(testFilePath, externalContent, 'utf-8');
      console.log('Wrote external change with marker:', UNIQUE_MARKER);

      // Wait for file watcher to detect the change and propagate to editor
      // chokidar debounce + IPC + delta processing + CM6 setValue
      const syncWorked = await appWindow.evaluate(async ({ winId, marker }: { winId: string; marker: string }) => {
        // Poll for up to 5 seconds
        for (let i = 0; i < 50; i++) {
          await new Promise(r => setTimeout(r, 100));
          const escapedWinId = CSS.escape(winId);
          const el = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
          if (!el) continue;
          const cmView = (el as CodeMirrorElement).cmView?.view;
          if (!cmView) continue;
          const content = cmView.state.doc.toString();
          if (content.includes(marker)) return true;
        }
        return false;
      }, { winId: editorWindowId, marker: UNIQUE_MARKER });

      // Read final editor content for assertion
      const finalContent = await appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const el = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null;
        if (!el) return null;
        const cmView = (el as CodeMirrorElement).cmView?.view;
        return cmView ? cmView.state.doc.toString() : null;
      }, editorWindowId);

      console.log('Final editor content:', finalContent?.substring(0, 120) + '...');
      console.log('Sync worked:', syncWorked);

      // The editor should contain the externally written marker
      expect(finalContent).toContain(UNIQUE_MARKER);

      // Close the editor before restoring (prevent autosave overwriting)
      await appWindow.evaluate((winId) => {
        const escapedWinId = CSS.escape(winId);
        const closeBtn = document.querySelector(`#${escapedWinId} .traffic-light-close`) as HTMLButtonElement | null;
        if (closeBtn) closeBtn.click();
      }, editorWindowId);
      await appWindow.waitForTimeout(200);

      console.log('Pinned editor FS sync test completed');
    } finally {
      // Always restore original file content
      await fs.writeFile(testFilePath, originalContent, 'utf-8');
      await appWindow.waitForTimeout(200);
      console.log('Original file content restored');
    }
  });
});

export { test };
