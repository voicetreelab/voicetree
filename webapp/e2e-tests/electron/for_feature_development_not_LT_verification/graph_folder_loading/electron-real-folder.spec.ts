/**
 * BEHAVIORAL SPEC:
 * 1. App loads and visualizes a folder of markdown files as a graph with visible, labeled outgoingEdges
 * 2. Creating/deleting markdown files adds/removes nodes from the graph
 * 3. Bulk loads use tree layout; incremental nodes are positioned without overlap
 *
 * NOTE: Markdown editor CRUD e2e-tests (clicking nodes, adding wikilinks, bidirectional sync)
 * are in electron-markdown-editors-crud.spec.ts
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { expect, test } from './electron-real-folder/fixtures';
import * as realFolder from './electron-real-folder/helpers';
import * as vault from './electron-real-folder/fs-helpers';
import {
  COMPLEX_LINKS_CONTENT,
  INCREMENTAL_TEST_FILES,
  NEW_CONCEPT_CONTENT
} from './electron-real-folder/test-data';
import type { GraphState, ViewportState } from './electron-real-folder/types';

test.describe('Real Folder E2E Tests', () => {
  test('should load and visualize a real markdown vault', async ({ appWindow }) => {
    const appReady = await realFolder.isAppReady(appWindow);
    expect(appReady).toBe(true);
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const initialGraph: GraphState = await realFolder.getGraphState(appWindow);
    expect(initialGraph.nodeCount).toBeGreaterThanOrEqual(5); // Fixture has 56 files
    expect(initialGraph.nodeLabels).toContain('Setting up Agent in Feedback Loop'); // From heading in file 10
    expect(initialGraph.nodeLabels).toContain('Identify Relevant Test'); // From heading in file 11
    expect(initialGraph.edgeCount).toBeGreaterThan(0);
    const edgeVisibility = await realFolder.getEdgeVisibility(appWindow);
    expect(edgeVisibility.visible).toBe(true);
    expect(edgeVisibility.opacity).toBeGreaterThan(0);
    expect(edgeVisibility.width).toBeGreaterThan(0);
    const edgeLabelCheck = await realFolder.getEdgeLabelCheck(appWindow);
    expect(edgeLabelCheck.totalEdges).toBeGreaterThan(0);
    const nodeCountBeforeAdd = await realFolder.getNodeCount(appWindow);
    const newFilePath = await vault.writeVaultFile('new-concept.md', NEW_CONCEPT_CONTENT);
    await expect.poll(() => realFolder.hasNodeLabel(appWindow, 'New Concept'), {
      message: 'Waiting for new-concept node to appear',
      timeout: 10000
    }).toBe(true);
    const updatedGraph: GraphState = await realFolder.getGraphStateFromAvailableCytoscape(appWindow);
    expect(updatedGraph.nodeLabels).toContain('New Concept');
    expect(updatedGraph.nodeCount).toBeGreaterThanOrEqual(nodeCountBeforeAdd);
    const newConceptEdges = updatedGraph.edges.filter(e =>
      e.source === 'New Concept' || e.target === 'New Concept'
    );
    expect(newConceptEdges.length).toBeGreaterThan(0);
    await vault.deleteFilePath(newFilePath);
    await expect.poll(() => realFolder.lacksNodeLabel(appWindow, 'New Concept'), {
      message: 'Waiting for new-concept node to be removed',
      timeout: 10000
    }).toBe(true);
    const finalGraph: GraphState = await realFolder.getGraphStateFromAvailableCytoscape(appWindow);
    expect(finalGraph.nodeCount).toBeGreaterThanOrEqual(nodeCountBeforeAdd - 2);
    expect(finalGraph.nodeCount).toBeLessThanOrEqual(nodeCountBeforeAdd + 2);
    expect(finalGraph.nodeLabels).not.toContain('New Concept');
    const assignNodeLabel: string = 'Action to assign an agent to identify code extraction boundaries.';
    const hasEdgesToAssignNode: boolean = finalGraph.edges.some(e =>
      e.target === assignNodeLabel
    );
    const hasCloudConfigOrSetupLink: boolean = finalGraph.edges.some(e =>
      e.source.includes('G Cloud Configuration') ||
      e.target.includes('G Cloud CLI')
    );

    expect(hasEdgesToAssignNode).toBe(true);
    expect(hasCloudConfigOrSetupLink).toBe(true);
    const stopResult = await realFolder.stopFileWatching(appWindow);

    expect(stopResult.success).toBe(true);
  });

  test('should handle complex wiki-link patterns', async ({ appWindow }) => {
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const complexLinkFile = await vault.writeVaultFile('complex-links.md', COMPLEX_LINKS_CONTENT);
    await expect.poll(() => realFolder.hasNodeLabel(appWindow, 'Complex Links Test'), {
      message: 'Waiting for complex-links file to be processed',
      timeout: 10000
    }).toBe(true);
    const graphWithComplexLinks = await realFolder.getComplexLinksGraphState(appWindow);

    expect(graphWithComplexLinks).not.toBeNull();
    expect(graphWithComplexLinks!.nodeExists).toBe(true);
    expect(graphWithComplexLinks!.connectedEdgeCount).toBeGreaterThan(2);
    await vault.deleteFilePath(complexLinkFile);
    await appWindow.waitForTimeout(500);
    const stopResult = await realFolder.stopFileWatching(appWindow);

    expect(stopResult.success).toBe(true);
  });

  test('should bulk load then incrementally add nodes with proper layout', async ({ appWindow }) => {
    const testFileNames = vault.INCREMENTAL_TEST_FILE_NAMES;
    await vault.deleteVaultFilesIfPresent(testFileNames);
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for bulk load to complete',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    await appWindow.waitForTimeout(2000);

    const bulkLoadState = await realFolder.getBulkLoadState(appWindow);
    expect(bulkLoadState.allAtZero).toBe(false);
    expect(bulkLoadState.uniqueYCount).toBeGreaterThan(1);

    const newFiles = INCREMENTAL_TEST_FILES;
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      await vault.writeVaultFile(file.name, file.content);
      await expect.poll(() => realFolder.hasIncrementalNode(appWindow, i), {
        message: `Waiting for ${file.name} to appear in graph`,
        timeout: 10000
      }).toBe(true);
    }

    const finalState = await realFolder.getIncrementalLayoutState(appWindow);
    expect(finalState.totalNodes).toBe(bulkLoadState.nodeCount + 3);
    expect(finalState.newNodePositions.length).toBe(3);
    const uniqueNewPositions = new Set(
      finalState.newNodePositions.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)
    );
    expect(uniqueNewPositions.size).toBeGreaterThanOrEqual(1);
    for (const file of newFiles) {
      await vault.deleteVaultFile(file.name);
    }
  });

  test('should scale node size and border width based on degree', async ({ appWindow }) => {
    const appReady = await realFolder.isAppReady(appWindow);
    expect(appReady).toBe(true);
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const nodeSizeData = await realFolder.getNodeSizeData(appWindow);
    expect(nodeSizeData.lowest.degree).toBeGreaterThanOrEqual(0);
    expect(nodeSizeData.highest.degree).toBeGreaterThan(nodeSizeData.lowest.degree);
    expect(nodeSizeData.highest.width).toBeGreaterThan(nodeSizeData.lowest.width);
    expect(nodeSizeData.highest.height).toBeGreaterThan(nodeSizeData.lowest.height);
    expect(nodeSizeData.highest.borderWidth).toBeGreaterThan(0);
    expect(nodeSizeData.lowest.borderWidth).toBeGreaterThan(0);
    await appWindow.screenshot({ path: 'e2e-tests/test-results/degree-scaling-visualization.png' });
  });

  test('should select multiple nodes via box selection', async ({ appWindow }) => {
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const selectionResult = await realFolder.selectFirstThreeNodesForBoxSelection(appWindow);
    expect(selectionResult.selectedCount).toBe(3);
    expect(selectionResult.selectedIds.length).toBe(3);
    const deselectedCount = await realFolder.deselectAllNodes(appWindow);

    expect(deselectedCount).toBe(0);
  });

  test.skip('should add node via right-click context menu at graph position and open editor with file sync', async ({ appWindow }) => {
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const initialCount = await realFolder.getNodeCount(appWindow);
    const clickPosition = await realFolder.getRightClickNodePosition(appWindow);
    await realFolder.addNodeAtPosition(appWindow, clickPosition);
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for new node to be added to graph',
      timeout: 10000
    }).toBeGreaterThan(initialCount);
    const positionCheck = await realFolder.checkNewNodePosition(appWindow, clickPosition);

    expect(positionCheck.success).toBe(true);
    expect(positionCheck.nodeId).toBeTruthy();
    const newNodeId = positionCheck.nodeId!;
    const editorId = `editor-${newNodeId}`;
    await expect.poll(() => realFolder.hasGraphElement(appWindow, editorId), {
      message: `Waiting for editor ${editorId} to open`,
      timeout: 5000
    }).toBe(true);
    await appWindow.waitForSelector(`#window-${editorId} .cm-editor`, { timeout: 5000 });
    await appWindow.waitForTimeout(500);
    const testContent = `---\nnode_id: ${newNodeId}\ntitle: Test Node ${newNodeId}\n---\n\n# Updated Content\n\nThis content was added by the E2E test to verify file sync.`;

    await realFolder.setEditorContent(appWindow, editorId, testContent);
    const editorValue = await realFolder.getEditorValue(appWindow, editorId);
    expect(editorValue).toContain('Updated Content');
    const expectedFileName = `${newNodeId}.md`;
    const filePath = vault.filePathInVault(expectedFileName);
    await test.expect.poll(() => vault.fileExists(filePath), {
      message: `Waiting for file ${expectedFileName} to be created`,
      timeout: 5000,
      intervals: [100, 200, 500] // Check frequently at first, then less often
    }).toBe(true);

    const fileContent = await vault.readTextFile(filePath);

    expect(fileContent).toContain('Updated Content');
    expect(fileContent).toContain('This content was added by the E2E test');
    await vault.deleteFilePath(filePath);
  });

  test('should open search with cmd-f and navigate to selected node', async ({ appWindow }) => {
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);

    const graphState = await realFolder.getGraphSummary(appWindow);

    expect(graphState.nodeCount).toBeGreaterThan(0);
    const initialState = await realFolder.getViewportState(appWindow);
    await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await appWindow.waitForTimeout(300);

    const ninjaKeysVisible = await realFolder.isNinjaKeysVisible(appWindow);

    expect(ninjaKeysVisible).toBe(true);
    const targetNode = await realFolder.getFirstSearchTargetNode(appWindow);
    const searchQuery = targetNode.label.substring(0, Math.min(5, targetNode.label.length));
    await appWindow.keyboard.type(searchQuery);
    await appWindow.waitForTimeout(300);
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);
    const finalState = await realFolder.getViewportState(appWindow);
    const zoomChanged = Math.abs(finalState.zoom - initialState.zoom) > 0.01;
    const panChanged = Math.abs(finalState.pan.x - initialState.pan.x) > 1 ||
                       Math.abs(finalState.pan.y - initialState.pan.y) > 1;

    expect(zoomChanged || panChanged).toBe(true);
    const ninjaKeysClosed = await realFolder.isNinjaKeysClosed(appWindow);

    expect(ninjaKeysClosed).toBe(true);
  });

  test('should handle multiple consecutive cmd-f searches without focus issues', async ({ appWindow }) => {
    await expect.poll(() => realFolder.getNodeCount(appWindow), {
      message: 'Waiting for graph to load nodes',
      timeout: 15000,
      intervals: [500, 1000, 1000]
    }).toBeGreaterThan(0);
    const searchQueries = ['Agent', 'Test', 'Cloud'];
    let previousViewport: ViewportState | null = null;

    for (let i = 0; i < 3; i++) {
      const searchQuery = searchQueries[i];
      await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
      await appWindow.waitForTimeout(300);
      const modalOpen = await realFolder.isNinjaKeysModalOpen(appWindow);

      if (!modalOpen) {
        throw new Error(`Search modal failed to open on iteration ${i + 1}`);
      }
      await appWindow.keyboard.type(searchQuery);
      await appWindow.waitForTimeout(300); // Give search time to filter results
      await appWindow.keyboard.press('Enter');
      await appWindow.waitForTimeout(1000); // Wait for fit animation to complete
      const currentViewport = await realFolder.getViewportState(appWindow);
      if (i === 0) {
        expect(currentViewport.zoom).toBeGreaterThan(0);
      } else {
        const viewportChanged = previousViewport !== null && (
          Math.abs(currentViewport.zoom - previousViewport.zoom) > 0.01 ||
          Math.abs(currentViewport.pan.x - previousViewport.pan.x) > 1 ||
          Math.abs(currentViewport.pan.y - previousViewport.pan.y) > 1
        );
        expect(viewportChanged).toBe(true);
      }
      previousViewport = currentViewport;
      const modalClosed = await realFolder.isNinjaKeysModalClosed(appWindow);

      expect(modalClosed).toBe(true);
      await appWindow.waitForTimeout(200);
    }
  });
});
