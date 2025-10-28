import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileEvent } from '@/views/IVoiceTreeGraphView';

/**
 * Behavioral test for VoiceTreeGraphView
 *
 * Test Strategy:
 * 1. Mock window.electronAPI
 * 2. Create a VoiceTreeGraphView instance with container
 * 3. Trigger a file add event through the mocked electronAPI
 * 4. Verify that a node appears in the Cytoscape graph
 * 5. Call dispose() and verify cleanup
 *
 * This tests the CORE behavior: file events -> graph nodes
 * We test input/output behavior only, not internal implementation.
 */
describe('VoiceTreeGraphView', () => {
  let container: HTMLElement;
  let fileAddedHandler: ((data: FileEvent) => void) | null = null;
  let originalElectronAPI: any;

  beforeEach(() => {
    // Create container element with proper dimensions for Cytoscape
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    // Save original electronAPI
    originalElectronAPI = (window as any).electronAPI;

    // Mock window.electronAPI - capture the handler so we can trigger events
    (window as any).electronAPI = {
      onInitialFilesLoaded: vi.fn(),
      onFileAdded: vi.fn((handler) => {
        fileAddedHandler = handler;
      }),
      onFileChanged: vi.fn(),
      onFileDeleted: vi.fn(),
      onFileWatchingStopped: vi.fn(),
      onWatchingStarted: vi.fn(),
      removeAllListeners: vi.fn(),
    };
  });

  afterEach(() => {
    // Restore original electronAPI
    (window as any).electronAPI = originalElectronAPI;
  });

  it('should create a node in the graph when a file is added', async () => {
    // Import VoiceTreeGraphView
    const { VoiceTreeGraphView } = await import('@/views/VoiceTreeGraphView');

    // Step 1: Create view - constructor should subscribe to electronAPI events
    const view = new VoiceTreeGraphView(container, { headless: true });

    // Verify that the view subscribed to file events
    expect((window as any).electronAPI.onFileAdded).toHaveBeenCalled();

    // Step 2: Trigger file add event - simulate electronAPI detecting new file
    const fileEvent: FileEvent = {
      fullPath: '/test/vault/test-node.md',
      content: '# Test Node\n\nThis is test content',
    };

    // Call the captured handler to simulate electronAPI event
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
    expect((window as any).electronAPI.removeAllListeners).toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(container);
  });
});
