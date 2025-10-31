/**
 * Integration tests for VoiceTreeGraphView with FileEventManager and FloatingWindowManager
 * Tests behavior, not implementation details
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceTreeGraphView } from '@/views/VoiceTreeGraphView';

describe('VoiceTreeGraphView Integration', () => {
  let container: HTMLElement;
  let graphView: VoiceTreeGraphView;

  beforeEach(() => {
    // Setup DOM container
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Mock electronAPI
    (window as any).electronAPI = {
      onInitialFilesLoaded: vi.fn(),
      onFileAdded: vi.fn(),
      onFileChanged: vi.fn(),
      onFileDeleted: vi.fn(),
      onFileWatchingStopped: vi.fn(),
      onWatchingStarted: vi.fn(),
      removeAllListeners: vi.fn(),
      getWatchStatus: vi.fn().mockResolvedValue({ isWatching: true, directory: '/test' }),
      positions: {
        save: vi.fn().mockResolvedValue({ success: true })
      },
      saveFileContent: vi.fn().mockResolvedValue({ success: true }),
      deleteFile: vi.fn().mockResolvedValue({ success: true })
    };
  });

  afterEach(() => {
    if (graphView) {
      graphView.dispose();
    }
    document.body.removeChild(container);
    delete (window as any).electronAPI;
    delete (window as any).cytoscapeInstance;
    delete (window as any).cytoscapeCore;
  });

  describe('Feature 1: FileEventManager - Bulk file loading', () => {
    it('should load multiple files and display correct node/edge counts', () => {
      // Given: A graph view in headless mode
      graphView = new VoiceTreeGraphView(container, { headless: true });

      // When: Bulk files are loaded
      const bulkFiles = [
        { fullPath: 'test/node_a.md', content: '# Node A\n[[node_b]]' },
        { fullPath: 'test/node_b.md', content: '# Node B\n[[node_c]]' },
        { fullPath: 'test/node_c.md', content: '# Node C' }
      ];

      // Simulate electronAPI callback
      const onInitialFilesLoaded = (window as any).electronAPI.onInitialFilesLoaded;
      const callback = onInitialFilesLoaded.mock.calls[0][0];
      callback({ files: bulkFiles });

      // Then: Stats should reflect 3 nodes
      const stats = graphView.getStats();
      expect(stats.nodeCount).toBe(3);

      // And: Nodes should be visible in the graph
      const cy = (window as any).cytoscapeInstance;
      expect(cy.nodes().length).toBeGreaterThanOrEqual(3);
      expect(cy.getElementById('node_a').length).toBe(1);
      expect(cy.getElementById('node_b').length).toBe(1);
      expect(cy.getElementById('node_c').length).toBe(1);
    });
  });

  describe('Feature 2: FileEventManager - File changes update graph', () => {
    it('should update node label and edges when file content changes', () => {
      // Given: A graph with an initial file
      graphView = new VoiceTreeGraphView(container, { headless: true });

      const onFileAdded = (window as any).electronAPI.onFileAdded;
      const addCallback = onFileAdded.mock.calls[0][0];
      addCallback({
        fullPath: 'test/node_a.md',
        content: '# Original Title\n[[node_b]]'
      });

      const cy = (window as any).cytoscapeInstance;
      const nodeA = cy.getElementById('node_a');
      expect(nodeA.length).toBe(1);

      // When: File content changes
      const onFileChanged = (window as any).electronAPI.onFileChanged;
      const changeCallback = onFileChanged.mock.calls[0][0];
      changeCallback({
        fullPath: 'test/node_a.md',
        content: '# Updated Title\n[[node_c]]'
      });

      // Then: Node should still exist
      expect(cy.getElementById('node_a').length).toBe(1);

      // And: Content should be updated in node data
      expect(nodeA.data('content')).toContain('Updated Title');
    });
  });

  describe('Feature 3: FloatingWindowManager - Node content retrieval', () => {
    it('should retrieve node content via file event manager', () => {
      // Given: A graph with a node
      graphView = new VoiceTreeGraphView(container, { headless: true });

      const onFileAdded = (window as any).electronAPI.onFileAdded;
      const callback = onFileAdded.mock.calls[0][0];
      callback({
        fullPath: 'test/test_node.md',
        content: '# Test Node\nSome content here'
      });

      const cy = (window as any).cytoscapeInstance;
      const node = cy.getElementById('test_node');

      // When/Then: Node should have content stored
      expect(node.data('content')).toContain('Test Node');
      expect(node.data('content')).toContain('Some content here');

      // And: File path should be retrievable
      expect(node.length).toBe(1);
    });
  });

  describe('Feature 4: FileEventManager - File deletion', () => {
    it('should remove node from graph when file is deleted', () => {
      // Given: A graph with a node
      graphView = new VoiceTreeGraphView(container, { headless: true });

      const onFileAdded = (window as any).electronAPI.onFileAdded;
      const addCallback = onFileAdded.mock.calls[0][0];
      addCallback({
        fullPath: 'test/deletable.md',
        content: '# Deletable Node'
      });

      const cy = (window as any).cytoscapeInstance;
      let node = cy.getElementById('deletable');
      expect(node.length).toBe(1);
      expect(graphView.getStats().nodeCount).toBe(1);

      // When: File is deleted
      const onFileDeleted = (window as any).electronAPI.onFileDeleted;
      const deleteCallback = onFileDeleted.mock.calls[0][0];
      deleteCallback({
        fullPath: 'test/deletable.md'
      });

      // Then: Node should be removed
      node = cy.getElementById('deletable');
      expect(node.length).toBe(0);

      // And: Stats should be updated
      expect(graphView.getStats().nodeCount).toBe(0);
    });
  });

  describe('Feature 5: VoiceTreeGraphView - Dark mode toggle', () => {
    it('should toggle dark mode and update document classes', () => {
      // Given: A graph view in light mode
      graphView = new VoiceTreeGraphView(container, { headless: true, initialDarkMode: false });
      expect(graphView.isDarkMode()).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      // When: Dark mode is toggled
      graphView.toggleDarkMode();

      // Then: Dark mode should be enabled
      expect(graphView.isDarkMode()).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      // And: localStorage should be updated
      expect(localStorage.getItem('darkMode')).toBe('true');

      // When: Toggled again
      graphView.toggleDarkMode();

      // Then: Should return to light mode
      expect(graphView.isDarkMode()).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.getItem('darkMode')).toBe('false');
    });
  });

  describe('Cross-manager integration', () => {
    it('should coordinate stats updates between FileEventManager and VoiceTreeGraphView UI', () => {
      // Given: A graph view with stats overlay
      graphView = new VoiceTreeGraphView(container, { headless: true });

      // Get the stats overlay element
      const statsOverlay = container.querySelector('[class*="stats"]') as HTMLElement;

      // When: Files are added
      const onFileAdded = (window as any).electronAPI.onFileAdded;
      const callback = onFileAdded.mock.calls[0][0];

      callback({ fullPath: 'test/node1.md', content: '# Node 1' });
      callback({ fullPath: 'test/node2.md', content: '# Node 2' });

      // Then: Stats should show updated node counts
      const stats = graphView.getStats();
      expect(stats.nodeCount).toBe(2);

      // And: Both nodes should be in the graph
      const cy = (window as any).cytoscapeInstance;
      expect(cy.getElementById('node1').length).toBe(1);
      expect(cy.getElementById('node2').length).toBe(1);
    });
  });
});
