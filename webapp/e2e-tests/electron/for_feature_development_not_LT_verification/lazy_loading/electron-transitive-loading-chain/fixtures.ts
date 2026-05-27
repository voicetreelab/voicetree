import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT: string = path.resolve(process.cwd());

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempDir: string;
  writeFolder: string;
  chainDir: string;
}>({
  /**
   * Creates a temp directory structure for testing transitive wikilink loading:
   *
   * tempDir/                    <- watched folder (root)
   *   writeFolder/              <- only A.md here (will be loaded immediately)
   *     A.md -> [[B]]
   *   chain/                    <- outside writeFolder, inside watched folder
   *     B.md -> [[C]]
   *     C.md -> [[D]]
   *     D.md (end of chain)
   *     orphan.md (no links to it)
   *
   * Expected behavior:
   * - A.md loaded because it's in writeFolder
   * - B.md, C.md, D.md loaded transitively via resolveLinkedNodesInWatchedFolder()
   * - orphan.md NOT loaded (nothing links to it)
   */
  tempDir: async ({}, use) => {
    const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-transitive-chain-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  chainDir: async ({ tempDir }, use) => {
    const chainDir: string = path.join(tempDir, 'chain');
    await fs.mkdir(chainDir);
    await use(chainDir);
  },

  writeFolder: async ({ tempDir, chainDir }, use) => {
    const writeFolder: string = path.join(tempDir, 'writeFolder');
    await fs.mkdir(writeFolder);

    // Only A.md is in writeFolder (this triggers the transitive loading)
    await fs.writeFile(
      path.join(writeFolder, 'A.md'),
      `# Node A
This is the entry point of the chain.
Links to: [[B]]
`
    );

    // B, C, D are outside writeFolder but inside watched folder
    await fs.writeFile(
      path.join(chainDir, 'B.md'),
      `# Node B
Second in the chain.
Links to: [[C]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'C.md'),
      `# Node C
Third in the chain.
Links to: [[D]]
`
    );

    await fs.writeFile(
      path.join(chainDir, 'D.md'),
      `# Node D
End of the chain. No outgoing links.
`
    );

    // Create an orphan node that should NOT be loaded (nothing links to it)
    await fs.writeFile(
      path.join(chainDir, 'orphan.md'),
      `# Orphan Node
This node has NO incoming links.
It should NOT be loaded via transitive resolution.
`
    );

    await use(writeFolder);
  },

  electronApp: async ({ tempDir, writeFolder }, use) => {
    const tempUserDataPath: string = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-transitive-chain-userdata-'));

    // Write config:
    // - watchedFolder (lastDirectory): tempDir (the root)
    // - writeFolder: tempDir/writeFolder (only A.md)
    // - This means B, C, D, orphan are in watched folder but outside writeFolder
    const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        lastDirectory: tempDir,
        vaultConfig: {
          [tempDir]: {
            writeFolder: writeFolder,
            readPaths: []
          }
        }
      }, null, 2),
      'utf8'
    );

    const electronApp: ElectronApplication = await electron.launch({
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
      const window: Page = await electronApp.firstWindow();
      await window.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await window.waitForTimeout(300);
    } catch {
      // ignore cleanup errors
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  },

  appWindow: async ({ electronApp }, use) => {
    const window: Page = await electronApp.firstWindow({ timeout: 10000 });

    window.on('console', msg => {
      const text: string = msg.text();
      if (text.includes('[loadFolder]') ||
          text.includes('resolveLinkedNodes') ||
          text.includes('findFileByName') ||
          text.includes('[handleFSEvent]')) {
        console.log(`[Browser] ${text}`);
      }
    });

    window.on('pageerror', error => {
      console.error('PAGE ERROR:', error.message);
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 10000 });
    await window.waitForTimeout(1000);

    await use(window);
  }
});

export { expect };
