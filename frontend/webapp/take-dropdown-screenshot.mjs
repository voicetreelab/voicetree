import { chromium } from 'playwright';

async function takeScreenshot() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Setup comprehensive mock electronAPI (copied from graph-delta-test-utils.ts)
  await page.addInitScript(() => {
    const mockElectronAPI = {
      main: {
        applyGraphDeltaToDBAndMem: async () => ({ success: true }),
        applyGraphDeltaToDBThroughMem: async (delta) => {
          delta.forEach((nodeDelta) => {
            if (nodeDelta.type === 'UpsertNode') {
              const node = nodeDelta.nodeToUpsert;
              mockElectronAPI.graph._graphState.nodes[node.relativeFilePathIsID] = node;
            } else if (nodeDelta.type === 'DeleteNode') {
              delete mockElectronAPI.graph._graphState.nodes[nodeDelta.nodeId];
            }
          });
          if (mockElectronAPI.graph._updateCallback) {
            setTimeout(() => {
              mockElectronAPI.graph._updateCallback?.(delta);
            }, 10);
          }
          return { success: true };
        },
        getGraph: async () => mockElectronAPI.graph._graphState,
        getNode: async (nodeId) => mockElectronAPI.graph._graphState.nodes[nodeId],
        loadSettings: async () => ({
          terminalSpawnPathRelativeToWatchedDirectory: '../',
          agents: [
            { name: 'Claude', command: 'claude "$AGENT_PROMPT"' },
            { name: 'Gemini', command: 'gemini' }
          ],
          agentPermissionModeChosen: true,
          INJECT_ENV_VARS: { AGENT_PROMPT: 'Test prompt' },
          shiftEnterSendsOptionEnter: true
        }),
        saveSettings: async () => ({ success: true }),
        saveNodePositions: async () => ({ success: true }),
        startFileWatching: async () => ({ success: true, directory: '/mock' }),
        stopFileWatching: async () => ({ success: true }),
        getWatchStatus: async () => ({ isWatching: true, directory: '/mock/watched/directory' }),
        loadPreviousFolder: async () => ({ success: false }),
        getBackendServerConfig: async () => null,
        setBackendServerConfig: async () => {},
        spawnTerminalWithContextNode: async () => {},
        spawnPlainTerminal: async () => {},
        killTerminal: async () => {},
        setClaudeProjectDirectory: async () => {},
        openInFinder: async () => {},
        openDirectory: async () => ({}),
        getPlatform: () => 'darwin',
      },
      graph: {
        _graphState: { nodes: {}, adjacencyList: {} },
        _updateCallback: null,
        onGraphDelta: (callback) => {
          mockElectronAPI.graph._updateCallback = callback;
          return () => { mockElectronAPI.graph._updateCallback = null; };
        },
      },
      renderer: {
        onGraphDelta: (callback) => {
          mockElectronAPI.graph._updateCallback = callback;
          return () => { mockElectronAPI.graph._updateCallback = null; };
        },
        onLaunchTerminal: () => () => {},
      },
    };
    window.electronAPI = mockElectronAPI;
  });

  await page.goto('http://localhost:3000');
  await page.waitForSelector('#root', { timeout: 10000, state: 'visible' });

  // Wait for cytoscape
  await page.waitForFunction(() => window.cytoscapeInstance !== undefined, { timeout: 15000 });
  await page.waitForTimeout(500);

  // Add a test node via GraphDelta
  await page.evaluate(() => {
    const graphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node.md',
          contentWithoutYamlOrLinks: '# Test Node\nThis tests the dropdown.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'Some', value: { x: 500, y: 300 } },
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' }
      }
    ];
    if (window.electronAPI?.graph?._updateCallback) {
      window.electronAPI.graph._updateCallback(graphDelta);
    }
  });

  await page.waitForTimeout(500);

  // Trigger hover on node to show menu
  await page.evaluate(() => {
    const cy = window.cytoscapeInstance;
    if (!cy) throw new Error('No cy');
    const node = cy.$('#test-node.md');
    if (node.length === 0) throw new Error('Node not found');
    node.emit('mouseover');
  });

  await page.waitForTimeout(400);

  // Show the Run button submenu programmatically
  const hasSubmenu = await page.evaluate(() => {
    const rightGroup = document.querySelector('.horizontal-menu-right-group');
    if (!rightGroup) return { error: 'No right group' };
    const runContainer = rightGroup.querySelector('div:first-child');
    if (!runContainer) return { error: 'No run container' };
    const submenu = runContainer.querySelector('.horizontal-menu-submenu');
    if (!submenu) return { error: 'No submenu - Run button may not have dropdown' };
    submenu.style.display = 'flex';
    return { success: true };
  });

  console.log('Submenu status:', hasSubmenu);

  await page.waitForTimeout(200);

  // Take screenshot
  await page.screenshot({
    path: 'e2e-tests/screenshots/run-button-dropdown.png',
    fullPage: true
  });

  console.log('Screenshot saved to e2e-tests/screenshots/run-button-dropdown.png');

  await browser.close();
}

takeScreenshot().catch(console.error);
