import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EditorView } from '@codemirror/view';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
      getGraph: () => Promise<{ nodes: Record<string, unknown> } | undefined>;
    };
  };
}

export interface CodeMirrorElement extends HTMLElement {
  cmView?: { view: EditorView };
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  testVaultPath: string;
}>({
  electronApp: [async ({}, use, testInfo) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-link-bug-test-'));
    const watchedFolder = path.join(tempUserDataPath, 'test-vault');
    const projectRoot = path.join(watchedFolder, 'voicetree');

    await fs.mkdir(projectRoot, { recursive: true });

    const testNodeFilename = 'test-node-with-link.md';
    const linkedNodeFilename = 'linked-node.md';
    const testNodeFilename2 = 'test-node-remove-link.md';
    const linkedNodeFilename2 = 'target-node.md';

    const initialContent = `---
---
# Test Node

This is a test node with a link to [[${linkedNodeFilename}]].

Some more content here.`;

    const initialContent2 = `---
---
# Test Node

This node has a link: [[${linkedNodeFilename2}]]

End of content.`;

    await fs.writeFile(path.join(projectRoot, testNodeFilename), initialContent, 'utf-8');
    await fs.writeFile(path.join(projectRoot, linkedNodeFilename), '---\n---\n# Linked Node\n\nThis is the linked node.', 'utf-8');
    await fs.writeFile(path.join(projectRoot, testNodeFilename2), initialContent2, 'utf-8');
    await fs.writeFile(path.join(projectRoot, linkedNodeFilename2), '---\n---\n# Target Node\n\nTarget.', 'utf-8');

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({ lastDirectory: watchedFolder }, null, 2), 'utf8');
    console.log('[Test] Watched folder:', watchedFolder);
    console.log('[Test] Vault path (with suffix):', projectRoot);

    (testInfo as unknown as { projectRoot: string }).projectRoot = projectRoot;

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
      },
      timeout: 8000
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not stop file watching during cleanup');
    }

    await electronApp.close();
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
    console.log('[Test] Cleaned up temp directory');
  }, { timeout: 45000 }],

  testVaultPath: async ({}, use, testInfo) => {
    await use((testInfo as unknown as { projectRoot: string }).projectRoot);
  },

  appWindow: [async ({ electronApp, testVaultPath: _testVaultPath }, use) => {
    const page = await electronApp.firstWindow();

    page.on('console', msg => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });

    page.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
      console.error('Stack:', error.stack);
    });

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

    const hasErrors = await page.evaluate(() => {
      const errors: string[] = [];
      if (!document.querySelector('#root')) errors.push('No #root element');
      const errorText = document.body.textContent;
      if (errorText?.includes('Error') || errorText?.includes('error')) {
        errors.push(`Page contains error text: ${errorText.substring(0, 200)}`);
      }
      return errors;
    });

    if (hasErrors.length > 0) {
      console.error('Pre-initialization errors:', hasErrors);
    }

    await page.waitForFunction(() => (window as ExtendedWindow).cytoscapeInstance, { timeout: 30000 });
    await page.waitForFunction(() => (window as ExtendedWindow).electronAPI?.main, { timeout: 30000 });
    await page.waitForTimeout(500);

    await use(page);
  }, { timeout: 30000 }]
});

export { expect };
