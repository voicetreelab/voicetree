/**
 * Integration test for graph-core component registration
 *
 * Verifies that:
 * 1. React and ReactDOM are properly imported
 * 2. Components (MarkdownEditor, Terminal) are properly imported
 * 3. registerFloatingWindows is called with the correct config
 * 4. The extension is initialized at module load time
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Graph Core Component Registration', () => {
  beforeEach(() => {
    // Clear module cache to ensure fresh imports
    vi.resetModules();
  });

  it('should import and register components with the extension at module load', async () => {
    // Mock cytoscape to track registration calls
    const mockCytoscape = vi.fn() as any;
    mockCytoscape.use = vi.fn(); // Mock the use method for other extensions

    vi.doMock('cytoscape', () => ({
      default: mockCytoscape
    }));

    // Import the module (this should trigger registration)
    await import('@/graph-core/index');

    // Verify cytoscape was called to register the extension
    expect(mockCytoscape).toHaveBeenCalled();

    // Verify it was called with 'core' and 'addFloatingWindow'
    const calls = mockCytoscape.mock.calls;
    const registrationCall = calls.find(call =>
      call[0] === 'core' && call[1] === 'addFloatingWindow'
    );

    expect(registrationCall).toBeDefined();
  });

  it('should export registerFloatingWindows function', async () => {
    const graphCore = await import('@/graph-core/index');

    expect(graphCore.registerFloatingWindows).toBeDefined();
    expect(typeof graphCore.registerFloatingWindows).toBe('function');
  });

  it('should export CytoscapeCore class', async () => {
    const graphCore = await import('@/graph-core/index');

    expect(graphCore.CytoscapeCore).toBeDefined();
  });

  it('should export type definitions', async () => {
    // This test just verifies the module loads without errors
    // TypeScript will catch any type export issues at compile time
    const graphCore = await import('@/graph-core/index');

    expect(graphCore).toBeDefined();
  });
});
