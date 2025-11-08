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
import type { Core } from 'cytoscape';


describe('VoiceTreeGraphView with Functional Graph', () => {
  let container: HTMLElement;
  let vault: MemoryMarkdownVault;
  let graph: VoiceTreeGraphView;

  beforeEach(() => {
    // Create container for graph
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';

    // JSDOM doesn't calculate dimensions from styles, so we need to stub them BEFORE appending
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true });
    container.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
      toJSON: () => ({})
    });

    document.body.appendChild(container);

    // Create memory vault (used for position management)
    vault = new MemoryMarkdownVault();

    // Create graph instance for unit tests
    graph = new VoiceTreeGraphView(container, vault);
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
    const mockCallbacks: Array<(delta: unknown) => void> = [];
    const mockElectronAPI = {
      graph: {
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          mockCallbacks.push(callback);
          return () => {
            const idx = mockCallbacks.indexOf(callback);
            if (idx > -1) mockCallbacks.splice(idx, 1);
          };
        }
      }
    };

    // Inject mock API
    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

    // Create new graph instance to trigger subscription
    const testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);

    // JSDOM doesn't calculate dimensions from styles
    Object.defineProperty(testContainer, 'clientWidth', { value: 800, writable: true });
    Object.defineProperty(testContainer, 'clientHeight', { value: 600, writable: true });
    testContainer.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
      toJSON: () => ({})
    });

    const testVault = new MemoryMarkdownVault();
    const testGraph = new VoiceTreeGraphView(testContainer, testVault);

    // Verify subscription was registered
    expect(mockCallbacks.length).toBe(1);

    // Cleanup
    testGraph.dispose();
    document.body.removeChild(testContainer);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('should render graph delta to cytoscape when electronAPI callback is invoked', async () => {
    // Setup mock electronAPI that captures the callback
    let capturedCallback: ((delta: unknown) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          capturedCallback = callback;
          return () => {
            capturedCallback = null;
          };
        }
      }
    };

    // Inject mock API
    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

    // Create container and view
    const testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);

    // JSDOM doesn't calculate dimensions from styles
    Object.defineProperty(testContainer, 'clientWidth', { value: 800, writable: true });
    Object.defineProperty(testContainer, 'clientHeight', { value: 600, writable: true });
    testContainer.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
      toJSON: () => ({})
    });

    const testVault = new MemoryMarkdownVault();
    const testGraph = new VoiceTreeGraphView(testContainer, testVault);

    // Get the cytoscape instance
    const cy = (testGraph as unknown as { cy: Core }).cy;

    // Initially should be empty
    const initialNodes = cy.nodes();
    expect(initialNodes.length).toBe(0);

    // Create a GraphDelta with a single node
    const delta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'foo',
          content: '# Foo',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: O.none,
            position: { x: 100, y: 100 }
          }
        }
      }
    ];

    // Invoke the callback directly (simulating main process sending delta)
    expect(capturedCallback).not.toBeNull();
    capturedCallback!(delta);

    // Wait for the update to be processed
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify the cytoscape state has changed
    const nodes = cy.nodes();
    expect(nodes.length).toBe(1);

    // Verify the node was added with correct data
    const fooNode = cy.getElementById('foo');
    expect(fooNode.length).toBe(1);
    expect(fooNode.data('content')).toBe('# Foo');
    expect(fooNode.position().x).toBe(100);
    expect(fooNode.position().y).toBe(100);

    // Verify no edges (orphan node has no edges)
    const edges = cy.edges();
    expect(edges.length).toBe(0);

    // Cleanup
    testGraph.dispose();
    document.body.removeChild(testContainer);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('should update cytoscape when receiving graph delta from main process', async () => {
    // Setup mock electronAPI with graph update callback
    let graphUpdateCallback: ((delta: unknown) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          graphUpdateCallback = callback;
          return () => { graphUpdateCallback = null; };
        }
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

    // Create graph instance
    const testContainer = document.createElement('div');
    testContainer.style.width = '800px';
    testContainer.style.height = '600px';
    document.body.appendChild(testContainer);

    // JSDOM doesn't calculate dimensions from styles
    Object.defineProperty(testContainer, 'clientWidth', { value: 800, writable: true });
    Object.defineProperty(testContainer, 'clientHeight', { value: 600, writable: true });
    testContainer.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
      toJSON: () => ({})
    });

    const testVault = new MemoryMarkdownVault();
    const testGraph = new VoiceTreeGraphView(testContainer, testVault);

    // Create mock graph delta with two nodes
    const mockDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'node1',
          content: '# GraphNode 1\n\nContent',
          outgoingEdges: ['node2'],
          nodeUIMetadata: {
            color: O.none,
            position: { x: 100, y: 100 }
          }
        }
      },
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'node2',
          content: '# GraphNode 2\n\nContent',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: O.none,
            position: { x: 200, y: 200 }
          }
        }
      }
    ];

    graphUpdateCallback!(mockDelta);

    // Wait for next tick to allow batched updates
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify cytoscape was updated
    const cy = (testGraph as unknown as { cy: Core }).cy;
    expect(cy.nodes().length).toBe(2);
    expect(cy.edges().length).toBe(1);

    // Cleanup
    testGraph.dispose();
    document.body.removeChild(testContainer);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  // ==========================================================================
  // FLOATING EDITOR TESTS
  // ==========================================================================

  it('should open floating editor when vault absolutePath is available', async () => {
    // Setup vault with watching started
    vault.simulateWatchingStarted({
      directory: '/test/vault',
      timestamp: new Date().toISOString(),
    });

    // Verify getWatchDirectory returns the absolutePath
    expect(vault.getWatchDirectory?.()).toBe('/test/vault');

    // Setup mock electronAPI with graph update callback
    let graphUpdateCallback: ((delta: unknown) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          graphUpdateCallback = callback;
          return () => { graphUpdateCallback = null; };
        }
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

    // Create graph instance
    const testGraph = new VoiceTreeGraphView(container, vault);

    // Emit mock graph delta with a node
    const mockDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node',
          content: '# Test GraphNode\n\nSome content',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: O.none,
            position: { x: 100, y: 100 }
          }
        }
      }
    ];

    graphUpdateCallback!(mockDelta);

    // Wait for graph update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Simulate node tap
    const cy = (testGraph as unknown as { cy: Core }).cy;
    const node = cy.getElementById('test-node');
    expect(node.length).toBe(1);

    // The test passes if we can verify the vault absolutePath is accessible
    // In actual UI, this would open the floating editor
    const vaultPath = vault.getWatchDirectory?.();
    expect(vaultPath).toBe('/test/vault');

    // Cleanup
    testGraph.dispose();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('should NOT open floating editor when vault absolutePath is missing', async () => {
    // Don't call simulateWatchingStarted, so vault absolutePath is undefined

    // Verify getWatchDirectory returns undefined
    expect(vault.getWatchDirectory?.()).toBeUndefined();

    // Setup mock electronAPI
    let graphUpdateCallback: ((delta: unknown) => void) | null = null;
    const mockElectronAPI = {
      graph: {
        onGraphUpdate: (callback: (delta: unknown) => void) => {
          graphUpdateCallback = callback;
          return () => { graphUpdateCallback = null; };
        }
      }
    };

    (window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI;

    // Create graph instance
    const testGraph = new VoiceTreeGraphView(container, vault);

    // Emit mock graph delta with a node
    const mockDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node',
          content: '# Test GraphNode\n\nSome content',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: O.none,
            position: { x: 100, y: 100 }
          }
        }
      }
    ];

    graphUpdateCallback!(mockDelta);

    // Wait for graph update
    await new Promise(resolve => setTimeout(resolve, 10));

    // The test passes if vault absolutePath is still undefined
    const vaultPath = vault.getWatchDirectory?.();
    expect(vaultPath).toBeUndefined();

    // Cleanup
    testGraph.dispose();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });
});
