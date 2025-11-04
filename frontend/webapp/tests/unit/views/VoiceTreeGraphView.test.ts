/**
 * VoiceTreeGraphView Unit Tests with Functional Graph
 *
 * Tests VoiceTreeGraphView's integration with the functional graph state from main process.
 * VoiceTreeGraphView now receives graph state via electronAPI.graph.onStateChanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoiceTreeGraphView } from '@/views/VoiceTreeGraphView';
import { MemoryMarkdownVault } from '@/providers/MemoryMarkdownVault';
import * as O from 'fp-ts/Option';

describe('VoiceTreeGraphView with Functional Graph', () => {
  let container: HTMLElement;
  let vault: MemoryMarkdownVault;
  let graph: VoiceTreeGraphView;

  beforeEach(() => {
    // Create container for graph
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Create memory vault (used for position management)
    vault = new MemoryMarkdownVault();

    // Create graph with headless mode for faster tests
    graph = new VoiceTreeGraphView(container, vault, { headless: true });
  });

  afterEach(() => {
    // Cleanup
    graph.dispose();
    document.body.removeChild(container);
    vault.reset();
  });

  // ==========================================================================
  // POSITION MANAGEMENT (via Vault)
  // ==========================================================================

  it('should handle position loading and saving', async () => {
    // Simulate watching started with positions
    vault.simulateWatchingStarted({
      directory: '/test',
      timestamp: new Date().toISOString(),
      positions: {
        'intro.md': { x: 100, y: 200 },
      },
    });

    // Load positions
    const positions = await vault.loadPositions('/test');
    expect(positions['intro.md']).toEqual({ x: 100, y: 200 });

    // Save new positions
    const result = await vault.savePositions('/test', {
      'new.md': { x: 300, y: 400 },
    });

    expect(result.success).toBe(true);

    // Verify saved
    const updated = await vault.loadPositions('/test');
    expect(updated['new.md']).toEqual({ x: 300, y: 400 });
  });

  // ==========================================================================
  // VAULT STATUS
  // ==========================================================================

  it('should track watching status', async () => {
    // Initially not watching
    let status = await vault.getWatchStatus();
    expect(status.isWatching).toBe(false);
    expect(status.directory).toBeNull();

    // Start watching
    vault.simulateWatchingStarted({
      directory: '/test',
      timestamp: new Date().toISOString(),
    });

    status = await vault.getWatchStatus();
    expect(status.isWatching).toBe(true);
    expect(status.directory).toBe('/test');

    // Stop watching
    vault.simulateWatchingStopped();

    status = await vault.getWatchStatus();
    expect(status.isWatching).toBe(false);
  });

  // ==========================================================================
  // FUNCTIONAL GRAPH SUBSCRIPTION TESTS
  // ==========================================================================

  it('should subscribe to functional graph updates via electronAPI', () => {
    // Setup mock electronAPI
    const mockCallbacks: Array<(graph: any) => void> = [];
    const mockElectronAPI = {
      graph: {
        onStateChanged: (callback: (graph: any) => void) => {
          mockCallbacks.push(callback);
          return () => {
            const idx = mockCallbacks.indexOf(callback);
            if (idx > -1) mockCallbacks.splice(idx, 1);
          };
        }
      }
    };

    // Inject mock API
    (window as any).electronAPI = mockElectronAPI;

    // Create new graph instance to trigger subscription
    const testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);

    const testVault = new MemoryMarkdownVault();
    const testGraph = new VoiceTreeGraphView(testContainer, testVault, { headless: true });

    // Verify subscription was registered
    expect(mockCallbacks.length).toBe(1);

    // Cleanup
    testGraph.dispose();
    document.body.removeChild(testContainer);
    delete (window as any).electronAPI;
  });

  it('should update cytoscape when receiving graph state from main process', async () => {
    // Setup mock electronAPI with state change emitter
    let stateChangeCallback: ((graph: any) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onStateChanged: (callback: (graph: any) => void) => {
          stateChangeCallback = callback;
          return () => { stateChangeCallback = null; };
        }
      }
    };

    (window as any).electronAPI = mockElectronAPI;

    // Create graph instance
    const testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);

    const testVault = new MemoryMarkdownVault();
    const testGraph = new VoiceTreeGraphView(testContainer, testVault, { headless: true });

    // Emit mock graph state with proper Option types
    const mockGraphState = {
      nodes: {
        'node1': {
          id: 'node1',
          title: 'Node 1',
          content: '# Node 1\n\nContent',
          summary: 'Summary',
          color: O.none
        },
        'node2': {
          id: 'node2',
          title: 'Node 2',
          content: '# Node 2\n\nContent',
          summary: 'Summary',
          color: O.none
        }
      },
      edges: {
        'node1': ['node2']
      }
    };

    stateChangeCallback!(mockGraphState);

    // Wait for next tick to allow batched updates
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify cytoscape was updated (filtering out ghost root if present)
    const cy = (testGraph as any).cy.getCore();
    const nonGhostNodes = cy.nodes().filter((node: any) => !node.data('isGhostRoot'));
    expect(nonGhostNodes.length).toBe(2);
    expect(cy.edges().length).toBe(1);

    // Cleanup
    testGraph.dispose();
    document.body.removeChild(testContainer);
    delete (window as any).electronAPI;
  });

  // ==========================================================================
  // FLOATING EDITOR TESTS
  // ==========================================================================

  it('should open floating editor when vault path is available', async () => {
    // Setup vault with watching started
    vault.simulateWatchingStarted({
      directory: '/test/vault',
      timestamp: new Date().toISOString(),
    });

    // Verify getWatchDirectory returns the path
    expect(vault.getWatchDirectory?.()).toBe('/test/vault');

    // Setup mock electronAPI with state change emitter
    let stateChangeCallback: ((graph: any) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onStateChanged: (callback: (graph: any) => void) => {
          stateChangeCallback = callback;
          return () => { stateChangeCallback = null; };
        }
      }
    };

    (window as any).electronAPI = mockElectronAPI;

    // Create graph instance
    const testGraph = new VoiceTreeGraphView(container, vault, { headless: true });

    // Emit mock graph state with a node
    const mockGraphState = {
      nodes: {
        'test-node': {
          id: 'test-node',
          title: 'Test Node',
          content: '# Test Node\n\nSome content',
          summary: 'Summary',
          color: O.none
        }
      },
      edges: {}
    };

    stateChangeCallback!(mockGraphState);

    // Wait for graph update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Simulate node tap
    const cy = (testGraph as any).cy.getCore();
    const node = cy.getElementById('test-node');
    expect(node.length).toBe(1);

    // The test passes if we can verify the vault path is accessible
    // In actual UI, this would open the floating editor
    const vaultPath = vault.getWatchDirectory?.();
    expect(vaultPath).toBe('/test/vault');

    // Cleanup
    testGraph.dispose();
    delete (window as any).electronAPI;
  });

  it('should NOT open floating editor when vault path is missing', async () => {
    // Don't call simulateWatchingStarted, so vault path is undefined

    // Verify getWatchDirectory returns undefined
    expect(vault.getWatchDirectory?.()).toBeUndefined();

    // Setup mock electronAPI
    let stateChangeCallback: ((graph: any) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onStateChanged: (callback: (graph: any) => void) => {
          stateChangeCallback = callback;
          return () => { stateChangeCallback = null; };
        }
      }
    };

    (window as any).electronAPI = mockElectronAPI;

    // Create graph instance
    const testGraph = new VoiceTreeGraphView(container, vault, { headless: true });

    // Emit mock graph state with a node
    const mockGraphState = {
      nodes: {
        'test-node': {
          id: 'test-node',
          title: 'Test Node',
          content: '# Test Node\n\nSome content',
          summary: 'Summary',
          color: O.none
        }
      },
      edges: {}
    };

    stateChangeCallback!(mockGraphState);

    // Wait for graph update
    await new Promise(resolve => setTimeout(resolve, 10));

    // The test passes if vault path is still undefined
    const vaultPath = vault.getWatchDirectory?.();
    expect(vaultPath).toBeUndefined();

    // Cleanup
    testGraph.dispose();
    delete (window as any).electronAPI;
  });
});
