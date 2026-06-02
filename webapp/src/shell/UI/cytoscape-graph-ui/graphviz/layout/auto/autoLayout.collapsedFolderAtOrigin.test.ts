// @vitest-environment jsdom

/**
 * Regression test: collapsed folder proxy nodes added at (0,0) must NOT
 * trigger local Cola layout.
 *
 * The bug mechanism:
 * 1. `refreshFolderTreeFromMain()` async re-projection calls `cy.add()`
 *    for collapsed folder proxy nodes WITHOUT specifying a position.
 * 2. Cytoscape defaults unpositioned nodes to (0,0).
 * 3. `isLayoutParticipantNode` returns TRUE for collapsed folders
 *    (they are layout-eligible — they appear as regular nodes in the graph).
 * 4. Without the guard in `onNodeAdd`, this node would be tracked in
 *    `pendingNewNodeIds` and `runLocalCola` would run, pulling the entire
 *    neighborhood toward (0,0).
 *
 * This test proves:
 * - The dangerous preconditions exist (collapsed folder = layout participant + lands at 0,0)
 * - The current guard in `onNodeAdd` correctly prevents the folder from being tracked
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular, CollectionReturnValue } from 'cytoscape';
import { isLayoutParticipantNode } from '@/shell/UI/cytoscape-graph-ui/layoutParticipation';

// Mock window.hostAPI to prevent enableAutoLayout from calling main process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).hostAPI = {
  main: {
    loadSettings: () => Promise.resolve({ layoutConfig: undefined }),
    saveNodePositions: () => Promise.resolve(),
  },
};

// Mock the settings change subscription (imported by autoLayout.ts)
vi.mock('@/shell/edge/UI-edge/api', () => ({
  onSettingsChange: () => () => {},
}));

// Mock pending pan store
vi.mock('@/shell/edge/UI-edge/state/stores/PendingPanStore', () => ({
  computePendingPanAction: () => null,
  clearPendingPan: () => {},
  hasPendingPan: () => false,
  setPendingEditorFocusPan: () => {},
}));

// Mock apply pending pan
vi.mock('@/shell/UI/cytoscape-graph-ui/graphviz/layout/viewport/applyPendingPan', () => ({
  applyPendingPan: () => {},
}));

// Mock focused editor/terminal helpers
vi.mock('@/shell/edge/UI-edge/floating-windows/anchoring/speech-to-focused', () => ({
  getFocusedEditorNodeId: () => null,
  getFocusedTerminalShadowNodeId: () => null,
}));

// Mock responsive padding
vi.mock('@/utils/responsivePadding', () => ({
  getResponsivePadding: () => 50,
  cyFitIntoVisibleViewport: () => {},
}));

// Mock spatial index sync
vi.mock('@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync', () => ({
  refreshSpatialIndex: () => {},
  getCurrentIndex: () => undefined,
}));

// Mock Cola layout
vi.mock('@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola-engine/cola', () => ({
  default: class MockCola {
    run(): void {}
    one(_event: string, cb: () => void): void { cb(); }
  },
}));

// Mock runLocalCola to track calls
const runLocalColaSpy: ReturnType<typeof vi.fn> = vi.fn((_cy, _ids, _config, onComplete: () => void) => { onComplete(); });
vi.mock('./autoLayoutLocalCola', () => ({
  runLocalCola: (...args: unknown[]) => runLocalColaSpy(...args),
}));

// Dynamic import of enableAutoLayout AFTER mocks are set up
const { enableAutoLayout } = await import('./autoLayout');

describe('collapsed folder proxy at (0,0) — origin-pull bug mechanism', () => {
  let cy: Core;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    runLocalColaSpy.mockClear();

    // Need enough existing nodes so 1 new node is <30% of the graph
    // (the incremental path requires newNodeIds.size < totalNodes * 0.3)
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'file-a.md' }, position: { x: 500, y: 500 } },
        { data: { id: 'file-b.md' }, position: { x: 600, y: 400 } },
        { data: { id: 'file-c.md' }, position: { x: 400, y: 600 } },
        { data: { id: 'file-d.md' }, position: { x: 700, y: 300 } },
        { data: { id: 'edge-ab', source: 'file-a.md', target: 'file-b.md' } },
        { data: { id: 'edge-bc', source: 'file-b.md', target: 'file-c.md' } },
        { data: { id: 'edge-cd', source: 'file-c.md', target: 'file-d.md' } },
      ],
    });

    cleanup = enableAutoLayout(cy);

    // Force the initial layout to fire by adding a throwaway node + debounce.
    // enableAutoLayout only sets hasRunInitialLayout=true on first runLayout call,
    // which requires an event to trigger it. The initial elements were added before
    // the event listener was registered.
    cy.add({ group: 'nodes', data: { id: '__init__' }, position: { x: 300, y: 300 } });
    vi.advanceTimersByTime(400); // 300ms debounce + margin
    cy.remove(cy.$id('__init__'));
    vi.advanceTimersByTime(400); // Let the remove settle
    runLocalColaSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    cy.destroy();
    vi.useRealTimers();
  });

  it('precondition: collapsed folder node IS a layout participant', () => {
    // This is the dangerous condition — collapsed folders are eligible for Cola
    const folder: CollectionReturnValue = cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });
    expect(isLayoutParticipantNode(folder as NodeSingular)).toBe(true);
  });

  it('precondition: cytoscape places unpositioned nodes at (0,0)', () => {
    // This simulates what applyGraphDeltaToUI does — no position specified
    const folder: CollectionReturnValue = cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });
    expect(folder.position()).toEqual({ x: 0, y: 0 });
  });

  it('precondition: cytoscape fires add event for programmatically added nodes', () => {
    const addHandler: ReturnType<typeof vi.fn> = vi.fn();
    cy.on('add', 'node', addHandler);

    cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });

    expect(addHandler).toHaveBeenCalledTimes(1);
    cy.off('add', 'node', addHandler);
  });

  it('guard: collapsed folder at (0,0) does NOT trigger runLocalCola', () => {
    // Simulate what refreshFolderTreeFromMain does — adds a collapsed folder proxy
    // without a position (cytoscape defaults to 0,0)
    cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(400);

    // runLocalCola should NOT have been called because the onNodeAdd guard
    // prevents folder nodes from being added to pendingNewNodeIds
    expect(runLocalColaSpy).not.toHaveBeenCalled();
  });

  it('connected collapsed folder DOES trigger runLocalCola once synthetic topology exists', () => {
    cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });
    cy.add({
      group: 'edges',
      data: { id: 'synthetic-file-a-folder', source: 'file-a.md', target: 'folder/', isSyntheticEdge: true },
    });

    vi.advanceTimersByTime(400);

    expect(cy.getElementById('synthetic-file-a-folder').length).toBe(1);
    const passedNodeIds: Set<string> | undefined = runLocalColaSpy.mock.calls[0]?.[1];
    expect(passedNodeIds?.has('folder/')).toBe(true);
  });

  it('control: a regular file node at (0,0) DOES trigger runLocalCola', () => {
    // A regular file node without position should trigger local Cola
    cy.add({
      group: 'nodes',
      data: { id: 'new-file.md' },
      // No position — lands at (0,0) just like the folder
    });

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(400);

    // runLocalCola SHOULD fire for regular nodes
    expect(runLocalColaSpy).toHaveBeenCalledTimes(1);
    // Verify the new node ID was passed to runLocalCola
    const passedNodeIds: Set<string> = runLocalColaSpy.mock.calls[0][1];
    expect(passedNodeIds.has('new-file.md')).toBe(true);
  });

  it('combined: without the isFolderNode guard, collapsed folder WOULD be tracked as new node', () => {
    // This test directly proves the mechanism: isLayoutParticipantNode says YES
    // for collapsed folders, but the onNodeAdd guard says NO.
    // If someone removes the guard, runLocalCola would run with the folder at (0,0).
    const folder: CollectionReturnValue = cy.add({
      group: 'nodes',
      data: { id: 'folder/', isFolderNode: true, collapsed: true, childCount: 2 },
    });

    // The folder IS a layout participant (Cola would include it)
    expect(isLayoutParticipantNode(folder as NodeSingular)).toBe(true);
    // It IS at the origin (would pull neighbors toward 0,0)
    expect(folder.position()).toEqual({ x: 0, y: 0 });
    // But the guard prevents it from triggering layout
    vi.advanceTimersByTime(400);
    expect(runLocalColaSpy).not.toHaveBeenCalled();
    // Folder position remains unchanged (no layout ran)
    expect(folder.position()).toEqual({ x: 0, y: 0 });
  });
});
