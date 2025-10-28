import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileWatcherService, FileEvent } from '@/views/IVoiceTreeGraphView';

/**
 * Behavioral test for VoiceTreeGraphView
 *
 * This test follows TDD - it should FAIL initially because VoiceTreeGraphView doesn't exist yet.
 *
 * Test Strategy:
 * 1. Create a VoiceTreeGraphView instance with container and mocked FileWatcherService
 * 2. Trigger a file add event through the mocked FileWatcherService
 * 3. Verify that a node appears in the Cytoscape graph
 * 4. Call dispose() and verify cleanup
 *
 * This tests the CORE behavior: file events -> graph nodes
 * We test input/output behavior only, not internal implementation.
 */
describe('VoiceTreeGraphView', () => {
  let container: HTMLElement;
  let mockFileWatcher: FileWatcherService;
  let fileAddedHandler: ((data: FileEvent) => void) | null = null;

  beforeEach(() => {
    // Create container element with proper dimensions for Cytoscape
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Mock FileWatcherService - capture the handler so we can trigger events
    mockFileWatcher = {
      onBulkFilesAdded: vi.fn(),
      onFileAdded: vi.fn((handler) => {
        fileAddedHandler = handler;
      }),
      onFileChanged: vi.fn(),
      onFileDeleted: vi.fn(),
      onWatchingStopped: vi.fn(),
      onWatchingStarted: vi.fn(),
      dispose: vi.fn(),
    };
  });

  it('should create a node in the graph when a file is added', async () => {
    // This import will fail until VoiceTreeGraphView is implemented
    const { VoiceTreeGraphView } = await import('@/views/VoiceTreeGraphView');

    // Step 1: Create view - constructor should subscribe to file watcher events
    const view = new VoiceTreeGraphView(container, mockFileWatcher, { headless: true });

    // Verify that the view subscribed to file events
    expect(mockFileWatcher.onFileAdded).toHaveBeenCalled();

    // Step 2: Trigger file add event - simulate file watcher detecting new file
    const fileEvent: FileEvent = {
      fullPath: '/test/vault/test-node.md',
      content: '# Test Node\n\nThis is test content',
    };

    // Call the captured handler to simulate file watcher event
    if (!fileAddedHandler) {
      throw new Error('File added handler was not registered');
    }
    fileAddedHandler(fileEvent);

    // Give Cytoscape a tick to process (it may be async)
    await new Promise(resolve => setTimeout(resolve, 0));

    // Step 3: Verify node appears in graph
    // Access Cytoscape instance through the view's stats API
    const stats = view.getStats();
    expect(stats.nodeCount).toBeGreaterThan(0);

    // Verify we can get selected nodes (proves graph is functional)
    const selected = view.getSelectedNodes();
    expect(Array.isArray(selected)).toBe(true);

    // Step 4: Dispose and verify cleanup
    view.dispose();
    expect(mockFileWatcher.dispose).toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(container);
  });
});
