/**
 * BEHAVIORAL SPEC:
 * E2E test for lazy loading when adding a readPath.
 *
 * This test verifies that when a user adds a readPath via the UI:
 * 1. ONLY nodes that are linked by visible nodes are loaded
 * 2. Unlinked nodes remain hidden (NOT loaded into the graph)
 *
 * BUG BEING TESTED:
 * addReadOnLinkPath() currently uses loadVaultPathAdditively() which loads ALL files,
 * defeating lazy loading. This test will FAIL until the bug is fixed.
 *
 * EXPECTED OUTCOME (when bug is fixed):
 * - Adding a readPath should only load nodes that are linked from writeFolderPath nodes
 * - Unlinked nodes should remain hidden
 */

import { expect } from '@playwright/test';
import { test, testFileChange } from './electron-lazy-loading-add-path/fixtures';
import {
  addReadOnLinkPath,
  getAllEdges,
  getNodeIds,
  getSourceNodeData
} from './electron-lazy-loading-add-path/graph-helpers';
import {
  createTransitiveReadVault,
  linkSourceNodeToTarget
} from './electron-lazy-loading-add-path/test-data';

test.describe('Lazy Loading - addReadOnLinkPath', () => {
  test('should only load linked nodes when adding a readPath (BUG: currently loads ALL)', async ({
    appWindow,
    readPath
  }) => {
    test.setTimeout(30000);

    console.log('=== STEP 1: Verify initial state (only writeFolderPath nodes loaded) ===');

    const initialNodes = await getNodeIds(appWindow);

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.length).toBe(1);
    expect(initialNodes.some(id => id.includes('linking-node'))).toBe(true);
    expect(initialNodes.some(id => id.includes('linked-node'))).toBe(false);
    expect(initialNodes.some(id => id.includes('unlinked-node'))).toBe(false);

    console.log('=== STEP 2: Add readPath via API ===');
    console.log('Adding readPath:', readPath);

    const addResult = await addReadOnLinkPath(appWindow, readPath);

    console.log('addReadOnLinkPath result:', addResult);
    expect(addResult.success).toBe(true);

    await appWindow.waitForTimeout(1500);

    console.log('=== STEP 3: Verify lazy loading behavior ===');

    const nodesAfterAdd = await getNodeIds(appWindow);

    console.log('Nodes after addReadOnLinkPath:', nodesAfterAdd);

    // EXPECTED (when bug is fixed):
    // - linking-node (from writeFolderPath) - LOADED
    // - linked-node (from readPath, linked by linking-node) - LOADED
    // - unlinked-node (from readPath, not linked) - NOT LOADED

    console.log('=== VERIFICATION ===');
    console.log('Expected nodes: linking-node, linked-node');
    console.log('Should NOT have: unlinked-node');

    expect(nodesAfterAdd.some(id => id.includes('linking-node'))).toBe(true);

    const hasLinkedNode = nodesAfterAdd.some(id => id.includes('linked-node'));
    console.log('Has linked-node:', hasLinkedNode);
    expect(hasLinkedNode).toBe(true);

    const hasUnlinkedNode = nodesAfterAdd.some(id => id.includes('unlinked-node'));
    console.log('Has unlinked-node (BUG if true):', hasUnlinkedNode);
    expect(hasUnlinkedNode).toBe(false);

    console.log('Total node count:', nodesAfterAdd.length);
    expect(nodesAfterAdd.length).toBe(2);

    console.log('');
    console.log('=== TEST SUMMARY ===');
    console.log('Lazy loading test for addReadOnLinkPath:');
    console.log('- Initial state: only writeFolderPath nodes loaded');
    console.log('- After addReadOnLinkPath: only LINKED nodes from readPath loaded');
    console.log('- Unlinked nodes correctly remain hidden');
  });

  test('should load transitively linked nodes when adding readPath', async ({
    appWindow,
    testDir,
    writeFolderPath
  }) => {
    test.setTimeout(30000);

    const readPath = await createTransitiveReadVault(testDir, writeFolderPath);

    await appWindow.waitForTimeout(500);

    console.log('=== Adding readPath with transitive links ===');

    const addResult = await addReadOnLinkPath(appWindow, readPath);

    expect(addResult.success).toBe(true);
    await appWindow.waitForTimeout(1500);

    const nodes = await getNodeIds(appWindow);

    console.log('Nodes after transitive lazy load:', nodes);

    expect(nodes.some(id => id.includes('linking-node'))).toBe(true);
    expect(nodes.some(id => id.includes('/b.md'))).toBe(true);
    expect(nodes.some(id => id.includes('/c.md'))).toBe(true);

    const hasOrphan = nodes.some(id => id.includes('orphan'));
    console.log('Has orphan (BUG if true):', hasOrphan);
    expect(hasOrphan).toBe(false);
  });
});

/**
 * Separate test suite with its own fixtures for file-change triggered lazy loading
 */
testFileChange.describe('Lazy Loading - File Change Triggers', () => {
  testFileChange('should lazy load nodes when a file change adds a new link to readPath', async ({
    appWindow,
    writeFolderPath
  }) => {
    testFileChange.setTimeout(30000);

    console.log('=== STEP 1: Verify initial state (only source-node, no target-node) ===');

    const initialNodes = await getNodeIds(appWindow);

    console.log('Initial nodes:', initialNodes);
    expect(initialNodes.length).toBe(1);
    expect(initialNodes.some(id => id.includes('source-node'))).toBe(true);
    expect(initialNodes.some(id => id.includes('target-node'))).toBe(false);

    console.log('=== STEP 2: Edit source-node to add link [[target-node]] ===');

    await linkSourceNodeToTarget(writeFolderPath);

    await appWindow.waitForTimeout(2500);

    console.log('=== STEP 3: Verify lazy loading triggered ===');

    const nodesAfterEdit = await getNodeIds(appWindow);

    console.log('Nodes after edit:', nodesAfterEdit);

    const sourceNodeData = await getSourceNodeData(appWindow);

    console.log('Source node data:', JSON.stringify(sourceNodeData, null, 2));

    const allEdges = await getAllEdges(appWindow);

    console.log('All edges in cytoscape:', JSON.stringify(allEdges, null, 2));

    const hasTargetNode = nodesAfterEdit.some(id => id.includes('target-node'));

    const debugInfo = {
      nodesAfterEdit,
      sourceNodeData,
      allEdges,
      hasTargetNode
    };

    expect(hasTargetNode, `target-node not found. Debug info: ${JSON.stringify(debugInfo, null, 2)}`).toBe(true);
    // 3 nodes: source-node + target-node + shadow node (for editor anchor)
    expect(nodesAfterEdit.length).toBe(3);
  });
});

export { test };
