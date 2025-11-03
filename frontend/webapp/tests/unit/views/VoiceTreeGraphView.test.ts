/**
 * VoiceTreeGraphView Unit Tests with MemoryMarkdownVault
 *
 * Fast unit tests (< 100ms) that test graph logic without Electron.
 * Uses MemoryMarkdownVault for deterministic, in-memory testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoiceTreeGraphView } from '@/views/VoiceTreeGraphView';
import { MemoryMarkdownVault } from '@/providers/MemoryMarkdownVault';
import type { FileData } from '@/providers/IMarkdownVaultProvider';

describe('VoiceTreeGraphView with MemoryVault', () => {
  let container: HTMLElement;
  let vault: MemoryMarkdownVault;
  let graph: VoiceTreeGraphView;

  beforeEach(() => {
    // Create container for graph
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Create memory vault
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
  // BASIC FILE LOADING TESTS
  // ==========================================================================

  it('should add nodes when files are loaded', () => {
    // Simulate file load
    vault.simulateFilesLoaded([
      {
        path: 'intro.md',
        fullPath: '/test/intro.md',
        content: '# Introduction\n\nThis is the intro.',
        size: 100,
        modified: new Date().toISOString(),
      },
      {
        path: 'architecture.md',
        fullPath: '/test/architecture.md',
        content: '# Architecture\n\nSystem design.',
        size: 50,
        modified: new Date().toISOString(),
      },
    ]);

    // Assert graph has nodes
    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(2);
  });

  it('should create edges for wiki-links', () => {
    // Simulate files with wiki-link relationship
    vault.simulateFilesLoaded([
      {
        path: 'intro.md',
        fullPath: '/test/intro.md',
        content: '# Intro\n\nSee [[architecture]] for details.',
        size: 100,
        modified: new Date().toISOString(),
      },
      {
        path: 'architecture.md',
        fullPath: '/test/architecture.md',
        content: '# Architecture',
        size: 50,
        modified: new Date().toISOString(),
      },
    ]);

    // Assert edge was created
    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
  });

  // ==========================================================================
  // DYNAMIC FILE UPDATES
  // ==========================================================================

  it('should update graph when file is added', () => {
    // Start with one file
    vault.simulateFilesLoaded([
      {
        path: 'intro.md',
        fullPath: '/test/intro.md',
        content: '# Intro',
        size: 10,
        modified: new Date().toISOString(),
      },
    ]);

    expect(graph.getStats().nodeCount).toBe(1);

    // Add another file
    vault.simulateFileAdded({
      path: 'new.md',
      fullPath: '/test/new.md',
      content: '# New File',
      size: 20,
      modified: new Date().toISOString(),
    });

    // Should now have 2 nodes
    expect(graph.getStats().nodeCount).toBe(2);
  });

  it('should update graph when file changes', () => {
    // Initial file without links
    vault.simulateFileAdded({
      path: 'test.md',
      fullPath: '/test/test.md',
      content: '# Test',
      size: 10,
      modified: new Date().toISOString(),
    });

    expect(graph.getStats().nodeCount).toBe(1);
    expect(graph.getStats().edgeCount).toBe(0);

    // Update file to add a link
    vault.simulateFileChanged({
      path: 'test.md',
      fullPath: '/test/test.md',
      content: '# Test\n\n[[new-link]]',
      size: 30,
      modified: new Date().toISOString(),
    });

    // Should have added an edge (to non-existent node)
    expect(graph.getStats().edgeCount).toBeGreaterThan(0);
  });

  it('should remove node when file is deleted', () => {
    // Load two files
    vault.simulateFilesLoaded([
      {
        path: 'intro.md',
        fullPath: '/test/intro.md',
        content: '# Intro',
        size: 10,
        modified: new Date().toISOString(),
      },
      {
        path: 'other.md',
        fullPath: '/test/other.md',
        content: '# Other',
        size: 10,
        modified: new Date().toISOString(),
      },
    ]);

    expect(graph.getStats().nodeCount).toBe(2);

    // Delete one file
    vault.simulateFileDeleted('/test/other.md');

    // Should have one node left
    expect(graph.getStats().nodeCount).toBe(1);
  });

  // ==========================================================================
  // POSITION MANAGEMENT
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
  // COMPLEX SCENARIOS
  // ==========================================================================

  it('should handle multiple linked files', () => {
    vault.simulateFilesLoaded([
      {
        path: 'index.md',
        fullPath: '/test/index.md',
        content: '# Index\n\n[[a]] [[b]] [[c]]',
        size: 100,
        modified: new Date().toISOString(),
      },
      {
        path: 'a.md',
        fullPath: '/test/a.md',
        content: '# A\n\n[[b]]',
        size: 50,
        modified: new Date().toISOString(),
      },
      {
        path: 'b.md',
        fullPath: '/test/b.md',
        content: '# B\n\n[[c]]',
        size: 50,
        modified: new Date().toISOString(),
      },
      {
        path: 'c.md',
        fullPath: '/test/c.md',
        content: '# C',
        size: 20,
        modified: new Date().toISOString(),
      },
    ]);

    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(4);
    // index -> a, index -> b, index -> c, a -> b, b -> c = 5 edges
    expect(stats.edgeCount).toBeGreaterThanOrEqual(5);
  });

  it('should handle rapid file changes', () => {
    // Simulate rapid file additions
    for (let i = 0; i < 10; i++) {
      vault.simulateFileAdded({
        path: `file${i}.md`,
        fullPath: `/test/file${i}.md`,
        content: `# File ${i}`,
        size: 20,
        modified: new Date().toISOString(),
      });
    }

    expect(graph.getStats().nodeCount).toBe(10);
  });
});
