/**
 * BEHAVIORAL SPEC: External filesystem rename/delete semantics
 *
 * Covers the user-visible behavior decided in fs-rename-delete-semantics:
 * - Same-basename move should keep resolved links when watcher processes add/delete
 * - Basename-changing rename should not preserve old link relationships
 * - Delete should remove nodes/links from the active graph view
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import type { Core as CytoscapeCore } from 'cytoscape';

const PROJECT_ROOT = path.resolve(process.cwd());
const SOURCE_FILE_NAME = 'source.md';
const TARGET_FILE_NAME = 'target.md';
interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: {
    main: {
      getGraph: () => Promise<{
        nodes?: Record<string, {
          absoluteFilePathIsID?: string;
          contentWithoutYamlOrLinks?: string;
        }>;
      } | undefined>;
      getWatchStatus: () => Promise<{ isWatching: boolean; directory?: string }>;
      stopFileWatching: () => Promise<{ success: boolean; error?: string }>;
    };
  };
}

interface GraphNode {
  id: string;
  label: string;
  isShadowNode?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
}

interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
  tempVaultPath: string;
}>({
  tempVaultPath: [async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fs-semantics-'));
    const tempProjectPath = path.join(tempDir, 'fs-semantics-project');
    const tempVaultPath = path.join(tempProjectPath, 'voicetree');

    await fs.mkdir(tempVaultPath, { recursive: true });

    await fs.writeFile(
      path.join(tempVaultPath, SOURCE_FILE_NAME),
      '# Source Note\n\nThis note links to [[target]].\n'
    );

    await fs.writeFile(
      path.join(tempVaultPath, TARGET_FILE_NAME),
      '# Target Note\n\nThis target note is linked from source.md.\n'
    );

    await use(tempVaultPath);

    await fs.rm(tempDir, { recursive: true, force: true });
  }, { timeout: 45000 }],

  electronApp: [async ({ tempVaultPath }, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-fs-semantics-userdata-'));
    const tempProjectPath = path.dirname(tempVaultPath);
    const tempProjectName = path.basename(tempProjectPath);

    const configPath = path.join(tempUserDataPath, 'voicetree-config.json');
    await fs.writeFile(configPath, JSON.stringify({
      lastDirectory: tempProjectPath,
      vaultConfig: {
        [tempProjectPath]: {
          writePath: tempVaultPath,
          readPaths: []
        }
      }
    }, null, 2), 'utf8');

    const projectsPath = path.join(tempUserDataPath, 'projects.json');
    await fs.writeFile(projectsPath, JSON.stringify([{
      id: 'fs-rename-delete-semantics',
      path: tempProjectPath,
      name: tempProjectName,
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
      timeout: 15000
    });

    await use(electronApp);

    try {
      const page = await electronApp.firstWindow();
      await page.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (api) {
          await api.main.stopFileWatching();
        }
      });
      await page.waitForTimeout(300);
    } catch {
      console.log('Note: Could not interact with page before shutdown');
    }

    await electronApp.close();
    await fs.rm(tempUserDataPath, { recursive: true, force: true });
  }, { timeout: 45000 }],

  appWindow: [async ({ electronApp, tempVaultPath }, use) => {
    const page = await electronApp.firstWindow();
    const tempProjectName = path.basename(path.dirname(tempVaultPath));
    const tempProjectPath = path.dirname(tempVaultPath);
    page.on('console', (msg) => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', (error) => {
      console.error('PAGE ERROR:', error.message);
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('text=Recent Projects', { timeout: 10000 });
    const projectButton = page.locator('button', { hasText: tempProjectName }).first();
    await projectButton.waitFor({ timeout: 10000 });
    await projectButton.click();
    await page.waitForFunction(() => (window as unknown as ExtendedWindow).cytoscapeInstance, { timeout: 15000 });
    await expect.poll(async () => {
      return page.evaluate(({ sourceFilePath, targetFilePath, vaultPath }) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
        if (!cy) {
          return {
            sourceLoaded: false,
            targetLoaded: false
          };
        }

        const normalize = (value: string): string => value.replaceAll('\\', '/');
        const normalizedVaultPath = normalize(vaultPath);
        const normalizedSourcePath = normalize(sourceFilePath);
        const normalizedTargetPath = normalize(targetFilePath);

        const hasNodeForPath = (expectedPath: string): boolean => {
          return cy.nodes().some((node) => {
            const nodeId = node.id();
            const resolvedNodeId = nodeId.startsWith('/')
              ? normalize(nodeId)
              : normalize(`${normalizedVaultPath}/${nodeId}`);
            return resolvedNodeId === expectedPath;
          });
        };

        return {
          sourceLoaded: hasNodeForPath(normalizedSourcePath),
          targetLoaded: hasNodeForPath(normalizedTargetPath)
        };
      }, {
        sourceFilePath: path.join(tempVaultPath, SOURCE_FILE_NAME),
        targetFilePath: path.join(tempVaultPath, TARGET_FILE_NAME),
        vaultPath: tempVaultPath
      });
    }, {
      message: 'Waiting for source and target fixture nodes to load',
      timeout: 20000
    }).toEqual({
      sourceLoaded: true,
      targetLoaded: true
    });
    await expect.poll(async () => {
      return page.evaluate(async () => {
        const api = (window as unknown as ExtendedWindow).electronAPI;
        if (!api) {
          return { isWatching: false, directory: undefined };
        }
        return api.main.getWatchStatus();
      });
    }, {
      message: 'Waiting for file watcher to report active project root',
      timeout: 10000
    }).toEqual({
      isWatching: true,
      directory: tempProjectPath
    });
    await waitForExternalFsPipelineReady(page, path.join(tempVaultPath, SOURCE_FILE_NAME));

    await use(page);
  }, { timeout: 45000 }]
});

function getGraphSnapshot(window: Page): Promise<GraphSnapshot> {
  return window.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
    if (!cy) return { nodes: [], edges: [] };

    const nodes = cy.nodes().map((node) => ({
      id: node.id(),
      label: (node.data('label') as string) || '',
      isShadowNode: Boolean(node.data('isShadowNode'))
    }));

    const edges = cy.edges().map((edge) => ({
      source: edge.source().id(),
      target: edge.target().id()
    }));

    return {
      nodes,
      edges
    };
  });
}

function getMainProcessNodeContent(window: Page, filePath: string): Promise<string | null> {
  return window.evaluate(async (targetFilePath) => {
    const api = (window as unknown as ExtendedWindow).electronAPI;
    const graph = await api?.main.getGraph();
    if (!graph?.nodes) return null;

    for (const node of Object.values(graph.nodes)) {
      if (node?.absoluteFilePathIsID === targetFilePath) {
        return node.contentWithoutYamlOrLinks ?? '';
      }
    }

    return null;
  }, filePath);
}

function getNodeIdForFilePath(snapshot: GraphSnapshot, vaultPath: string, filePath: string): string | undefined {
  const normalizedExpected = path.normalize(filePath);
  return snapshot.nodes.find((node) => {
    const resolvedNodeId = path.isAbsolute(node.id)
      ? path.normalize(node.id)
      : path.normalize(path.join(vaultPath, node.id));
    return resolvedNodeId === normalizedExpected;
  })?.id;
}

function hasEdge(snapshot: GraphSnapshot, sourceNodeId: string | undefined, targetNodeId: string | undefined): boolean {
  if (!sourceNodeId || !targetNodeId) return false;
  return snapshot.edges.some((edge) => edge.source === sourceNodeId && edge.target === targetNodeId);
}

async function waitForExternalFsPipelineReady(window: Page, sourceFilePath: string): Promise<void> {
  const originalContent = await fs.readFile(sourceFilePath, 'utf8');
  const baselineGraphContent = await getMainProcessNodeContent(window, sourceFilePath);
  const marker = `WATCHER_READINESS_PROBE_${Date.now()}`;
  const updatedContent = `${originalContent.trimEnd()}\n\n${marker}\n`;

  await fs.writeFile(sourceFilePath, updatedContent, 'utf8');

  await expect.poll(async () => {
    const content = await getMainProcessNodeContent(window, sourceFilePath);
    return content?.includes(marker) ?? false;
  }, {
    message: 'Waiting for external filesystem probe write to reach main-process graph state',
    timeout: 15000,
    intervals: [250, 500, 1000]
  }).toBe(true);

  await fs.writeFile(sourceFilePath, originalContent, 'utf8');

  await expect.poll(async () => {
    const content = await getMainProcessNodeContent(window, sourceFilePath);
    return content === baselineGraphContent;
  }, {
    message: 'Waiting for external filesystem probe restoration to reach main-process graph state',
    timeout: 15000,
    intervals: [250, 500, 1000]
  }).toBe(true);
}

test.describe('Filesystem rename/delete semantics', () => {
  test('same-basename move should keep user-visible link behavior', async ({ appWindow, tempVaultPath }) => {
    test.setTimeout(60000);

    const sourceFilePath = path.join(tempVaultPath, SOURCE_FILE_NAME);
    const targetFilePath = path.join(tempVaultPath, TARGET_FILE_NAME);
    const movedTargetPath = path.join(tempVaultPath, 'archive', TARGET_FILE_NAME);

    const initial = await getGraphSnapshot(appWindow);
    const sourceNodeId = getNodeIdForFilePath(initial, tempVaultPath, sourceFilePath);
    const originalTargetNodeId = getNodeIdForFilePath(initial, tempVaultPath, targetFilePath);

    expect(sourceNodeId).toBeTruthy();
    expect(originalTargetNodeId).toBeTruthy();
    expect(hasEdge(initial, sourceNodeId, originalTargetNodeId)).toBe(true);

    await fs.mkdir(path.join(tempVaultPath, 'archive'), { recursive: true });
    await fs.rename(targetFilePath, movedTargetPath);

    await expect.poll(async () => {
      const snapshot = await getGraphSnapshot(appWindow);
      const movedTargetNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, movedTargetPath);
      const movedSourceNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, sourceFilePath);
      return {
        movedTargetExists: Boolean(movedTargetNodeId),
        oldTargetRemoved: !Boolean(getNodeIdForFilePath(snapshot, tempVaultPath, targetFilePath)),
        healedEdge: hasEdge(snapshot, movedSourceNodeId, movedTargetNodeId)
      };
    }, {
      message: 'Waiting for same-basename move to keep resolved links',
      timeout: 30000,
      intervals: [500, 1000, 2000]
    }).toEqual({
      movedTargetExists: true,
      oldTargetRemoved: true,
      healedEdge: true
    });

    const final = await getGraphSnapshot(appWindow);
    const finalTargetNodeId = getNodeIdForFilePath(final, tempVaultPath, movedTargetPath);
    const finalSourceNodeId = getNodeIdForFilePath(final, tempVaultPath, sourceFilePath);
    expect(hasEdge(final, finalSourceNodeId, finalTargetNodeId)).toBe(true);
  });

  test('basename-changing external rename should not preserve outgoing wiki link behavior', async ({ appWindow, tempVaultPath }) => {
    test.setTimeout(60000);

    const sourceFilePath = path.join(tempVaultPath, SOURCE_FILE_NAME);
    const targetFilePath = path.join(tempVaultPath, TARGET_FILE_NAME);
    const renamedTargetPath = path.join(tempVaultPath, 'target-renamed.md');

    const initial = await getGraphSnapshot(appWindow);
    const sourceNodeIdBefore = getNodeIdForFilePath(initial, tempVaultPath, sourceFilePath);
    const originalTargetNodeId = getNodeIdForFilePath(initial, tempVaultPath, targetFilePath);

    expect(sourceNodeIdBefore).toBeTruthy();
    expect(originalTargetNodeId).toBeTruthy();
    expect(hasEdge(initial, sourceNodeIdBefore, originalTargetNodeId)).toBe(true);

    await fs.rename(targetFilePath, renamedTargetPath);

    await expect.poll(async () => {
      const snapshot = await getGraphSnapshot(appWindow);
      const sourceNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, sourceFilePath);
      const renamedTargetNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, renamedTargetPath);
      const oldEdgeStillExists = hasEdge(snapshot, sourceNodeId, originalTargetNodeId);
      const renamedEdgeExists = hasEdge(snapshot, sourceNodeId, renamedTargetNodeId);
      return {
        oldTargetRemoved: !Boolean(getNodeIdForFilePath(snapshot, tempVaultPath, targetFilePath)),
        renamedTargetPresent: Boolean(renamedTargetNodeId),
        oldEdgeRemoved: !oldEdgeStillExists,
        renamedEdgeMissing: !renamedEdgeExists,
        sourceStillVisible: Boolean(sourceNodeId)
      };
    }, {
      message: 'Waiting for basename-changing rename contract to expose broken link behavior',
      timeout: 30000,
      intervals: [500, 1000, 2000]
    }).toEqual({
      oldTargetRemoved: true,
      renamedTargetPresent: true,
      oldEdgeRemoved: true,
      renamedEdgeMissing: true,
      sourceStillVisible: true
    });
  });

  test('external delete should remove the node and unlink incoming relationships', async ({ appWindow, tempVaultPath }) => {
    test.setTimeout(60000);

    const sourceFilePath = path.join(tempVaultPath, SOURCE_FILE_NAME);
    const targetFilePath = path.join(tempVaultPath, TARGET_FILE_NAME);

    const initial = await getGraphSnapshot(appWindow);
    const sourceNodeIdBefore = getNodeIdForFilePath(initial, tempVaultPath, sourceFilePath);
    const initialTargetNodeId = getNodeIdForFilePath(initial, tempVaultPath, targetFilePath);
    expect(sourceNodeIdBefore).toBeTruthy();
    expect(initialTargetNodeId).toBeTruthy();
    expect(hasEdge(initial, sourceNodeIdBefore, initialTargetNodeId)).toBe(true);

    await fs.unlink(targetFilePath);

    await expect.poll(async () => {
      const snapshot = await getGraphSnapshot(appWindow);
      const sourceNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, sourceFilePath);
      const deletedTargetNodeId = getNodeIdForFilePath(snapshot, tempVaultPath, targetFilePath);
      const edgeToDeletedTargetExists = hasEdge(snapshot, sourceNodeId, deletedTargetNodeId);
      const sourceOutgoingEdges = snapshot.edges.filter((edge) => edge.source === sourceNodeId).length;
      return {
        deletedTargetGone: !Boolean(deletedTargetNodeId),
        noEdgeToDeletedTarget: !edgeToDeletedTargetExists,
        sourceHasAtLeastOneNode: Boolean(sourceNodeId),
        sourceOutgoingEdges: sourceOutgoingEdges
      };
    }, {
      message: 'Waiting for delete processing to remove target node and unlink edge',
      timeout: 30000,
      intervals: [500, 1000, 2000]
    }).toEqual({
      deletedTargetGone: true,
      noEdgeToDeletedTarget: true,
      sourceHasAtLeastOneNode: true,
      sourceOutgoingEdges: 0
    });
  });
});

export { test };
