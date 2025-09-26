import { test, expect } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { EdgeData } from '../../src/graph-core/data/load_markdown/MarkdownParser';

// Test helper types
interface MockStatus {
  hasElectronAPI: boolean;
  hasMockElectronAPI: boolean;
  hasCytoscapeInstance: boolean;
}

interface GraphState {
  nodes: number;
  edges: number;
}

interface PerformanceMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
}

interface ExtendedWindow extends Window {
  electronAPI?: unknown;
  mockElectronAPI?: {
    listeners: unknown;
  };
  cytoscapeInstance?: CytoscapeCore;
  cytoscapeInstances?: CytoscapeCore[];
}

/**
 * Behavioral test for the file-to-graph pipeline
 * Tests the actual system behavior: file changes should result in graph updates
 * This is a true end-to-end test that verifies:
 * - Files added -> nodes appear in the graph
 * - Files with links -> edges appear in the graph
 * - Files modified -> graph updates
 * - Files deleted -> nodes and edges removed
 */
test.describe('File-to-Graph Pipeline Behavioral Tests', () => {
  test('should progressively build and update graph based on file operations', async ({ page }) => {
    // Capture console messages
    page.on('console', msg => {
      if (msg.text().includes('Mock') || msg.text().includes('useGraphManager') || msg.text().includes('Test:')) {
        console.log('Browser console:', msg.text());
      }
    });

    // Navigate to the application
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if mock is initialized
    const mockStatus = await page.evaluate((): MockStatus => {
      const win = window as ExtendedWindow;
      return {
        hasElectronAPI: !!win.electronAPI,
        hasMockElectronAPI: !!win.mockElectronAPI,
        hasCytoscapeInstance: !!win.cytoscapeInstance
      };
    });
    console.log('Mock status:', mockStatus);

    // STEP 1: Verify empty state - no graph should be displayed
    console.log('=== STEP 1: Verifying empty state ===');

    // The graph container should exist but show empty state message
    await expect(page.locator('text=Graph visualization will appear here')).toBeVisible();

    // Verify no nodes or edges are rendered in the canvas
    const nodeCount = await page.evaluate((): number => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.nodes().length : 0;
    });
    expect(nodeCount).toBe(0);

    // STEP 2: Simulate adding first markdown file
    console.log('=== STEP 2: Adding first markdown file ===');

    // Trigger file addition through the mock Electron API
    await page.evaluate(() => {
      const event = new CustomEvent('file-added', {
        detail: {
          path: 'concepts/introduction.md',
          content: '# Introduction\n\nThis is the introduction to our concept system.'
        }
      });
      console.log('Test: Dispatching file-added event:', event.detail);
      window.dispatchEvent(event);

      // Check if mock received the event
      setTimeout(() => {
        const mock = (window as ExtendedWindow).mockElectronAPI;
        if (mock) {
          console.log('Test: Mock API listeners:', mock.listeners);
        }
      }, 100);
    });

    // Wait a bit for the graph to initialize and update
    await page.waitForTimeout(1000);

    // Wait for node to appear in graph
    await expect.poll(async () => {
      return page.evaluate((): number => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? cy.nodes().length : 0;
      });
    }, {
      message: 'Waiting for 1 node to appear after file addition',
      timeout: 5000
    }).toBe(1);

    // Verify the node has the correct label
    const firstNodeLabel = await page.evaluate((): string | null => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy || cy.nodes().length === 0) return null;
      return cy.nodes()[0].data('label');
    });
    expect(firstNodeLabel).toBe('introduction');

    // STEP 3: Add second file with link to first
    console.log('=== STEP 3: Adding linked markdown file ===');

    await page.evaluate(() => {
      const event = new CustomEvent('file-added', {
        detail: {
          path: 'concepts/advanced.md',
          content: '# Advanced Concepts\n\nBuilding on the [[introduction]], we explore advanced topics.'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait for second node and edge to appear
    await expect.poll(async () => {
      return page.evaluate((): GraphState => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { nodes: 0, edges: 0 };
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for 2 nodes and 1 edge after second file addition',
      timeout: 5000
    }).toEqual({ nodes: 2, edges: 1 });

    // Verify edge connects the correct nodes
    const edgeData = await page.evaluate((): EdgeData | null => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy || cy.edges().length === 0) return null;
      const edge = cy.edges()[0];
      return {
        source: edge.source().data('label'),
        target: edge.target().data('label')
      };
    });
    expect(edgeData).toEqual({
      source: 'advanced',
      target: 'introduction'
    });

    // STEP 4: Modify a file
    console.log('=== STEP 4: Modifying file content ===');

    await page.evaluate(() => {
      const event = new CustomEvent('file-changed', {
        detail: {
          path: 'concepts/introduction.md',
          content: '# Introduction\n\nThis is the UPDATED introduction with more detail.'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait for modification to be processed (structure should remain the same)
    await expect.poll(async () => {
      return page.evaluate((): GraphState => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { nodes: 0, edges: 0 };
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for graph to remain stable after file modification',
      timeout: 5000
    }).toEqual({ nodes: 2, edges: 1 });

    // STEP 5: Delete a file
    console.log('=== STEP 5: Deleting a file ===');

    await page.evaluate(() => {
      const event = new CustomEvent('file-deleted', {
        detail: {
          path: 'concepts/advanced.md'
        }
      });
      window.dispatchEvent(event);
    });

    // Wait for node and edges to be removed after file deletion
    await expect.poll(async () => {
      return page.evaluate((): GraphState => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return { nodes: 0, edges: 0 };
        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length
        };
      });
    }, {
      message: 'Waiting for 1 node and 0 edges after file deletion',
      timeout: 5000
    }).toEqual({ nodes: 1, edges: 0 });

    // STEP 6: Verify graph performance metrics
    console.log('=== STEP 6: Checking performance metrics ===');

    // Verify no memory leaks or excessive re-renders
    const performanceMetrics = await page.evaluate((): PerformanceMetrics | null => {
      if (!performance.memory) return null;
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize
      };
    });

    if (performanceMetrics) {
      const heapUsageRatio = performanceMetrics.usedJSHeapSize / performanceMetrics.totalJSHeapSize;
      expect(heapUsageRatio).toBeLessThan(0.9); // Heap usage should be under 90%
    }

    console.log('✓ File-to-graph behavioral test completed successfully');
  });

  test('should handle rapid file changes without graph corruption', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    console.log('=== Testing rapid file changes ===');

    // Add multiple files rapidly
    await page.evaluate(() => {
      const files = [
        { path: 'file1.md', content: '# File 1' },
        { path: 'file2.md', content: '# File 2\n[[file1]]' },
        { path: 'file3.md', content: '# File 3\n[[file1]] [[file2]]' },
        { path: 'file4.md', content: '# File 4\n[[file3]]' }
      ];

      files.forEach((file, index) => {
        setTimeout(() => {
          const event = new CustomEvent('file-added', { detail: file });
          window.dispatchEvent(event);
        }, index * 50); // 50ms apart
      });
    });

    // Wait for all rapid file operations to complete
    await expect.poll(async () => {
      return page.evaluate((): { nodes: number; edges: number; isValid: boolean } | null => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return null;

        return {
          nodes: cy.nodes().length,
          edges: cy.edges().length,
          isValid: cy.nodes().every((n) => n.data('id') && n.data('label'))
        };
      });
    }, {
      message: 'Waiting for all 4 files to be processed in rapid changes test',
      timeout: 8000
    }).toMatchObject({
      nodes: 4,
      edges: expect.any(Number),
      isValid: true
    });

    // Verify minimum edge count separately
    const finalState = await page.evaluate((): number => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? cy.edges().length : 0;
    });
    expect(finalState).toBeGreaterThanOrEqual(4);

    console.log('✓ Rapid file change test completed');
  });

  test('should maintain graph consistency across visibility changes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Add initial files
    await page.evaluate(() => {
      const event1 = new CustomEvent('file-added', {
        detail: { path: 'test1.md', content: '# Test 1' }
      });
      const event2 = new CustomEvent('file-added', {
        detail: { path: 'test2.md', content: '# Test 2\n[[test1]]' }
      });
      window.dispatchEvent(event1);
      setTimeout(() => window.dispatchEvent(event2), 100);
    });

    // Wait for initial graph state to be established
    await expect.poll(async () => {
      return page.evaluate((): GraphState | null => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? { nodes: cy.nodes().length, edges: cy.edges().length } : null;
      });
    }, {
      message: 'Waiting for initial graph state with 2 nodes and 1 edge',
      timeout: 5000
    }).toEqual({ nodes: 2, edges: 1 });

    const initialStateValue = await page.evaluate((): GraphState | null => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      return cy ? { nodes: cy.nodes().length, edges: cy.edges().length } : null;
    });

    // Minimize and restore window (simulate visibility change)
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(200);

    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Verify state is maintained after visibility changes
    await expect.poll(async () => {
      return page.evaluate((): GraphState | null => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        return cy ? { nodes: cy.nodes().length, edges: cy.edges().length } : null;
      });
    }, {
      message: 'Waiting for graph state to remain consistent after visibility changes',
      timeout: 3000
    }).toEqual(initialStateValue);

    console.log('✓ Graph consistency test completed');
  });
});