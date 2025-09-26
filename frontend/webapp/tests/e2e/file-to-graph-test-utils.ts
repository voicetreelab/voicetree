import type { Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';

/**
 * Test utilities for file-to-graph pipeline tests
 * Handles multiple VoiceTreeLayout instances gracefully
 */

interface ExtendedWindow extends Window {
  cytoscapeInstance?: CytoscapeCore;
  cytoscapeInstances?: CytoscapeCore[];
}

export interface GraphTestHelpers {
  /**
   * Get the Cytoscape instance that has nodes (not empty)
   * Useful when multiple instances exist but only one has data
   */
  getActiveGraphInstance: () => Promise<CytoscapeCore | null>;

  /**
   * Get graph stats from UI instead of Cytoscape instance
   * More reliable when multiple instances exist
   */
  getGraphStatsFromUI: () => Promise<{ nodes: number; edges: number } | null>;

  /**
   * Wait for graph to update after file events
   * Checks both UI and Cytoscape instances
   */
  waitForGraphUpdate: (expectedNodes: number, expectedEdges: number) => Promise<boolean>;
}

export function createGraphTestHelpers(page: Page): GraphTestHelpers {
  return {
    getActiveGraphInstance: async () => {
      return page.evaluate((): CytoscapeCore | null => {
        const win = window as ExtendedWindow;
        // Check if we have multiple instances
        if (win.cytoscapeInstances?.length && win.cytoscapeInstances.length > 0) {
          // Find the instance with nodes
          return win.cytoscapeInstances.find((cy: CytoscapeCore) =>
            cy && cy.nodes && cy.nodes().length > 0
          ) || null;
        }
        // Fallback to single instance
        return win.cytoscapeInstance || null;
      });
    },

    getGraphStatsFromUI: async () => {
      return page.evaluate((): { nodes: number; edges: number } | null => {
        // Find the UI element showing "X nodes • Y edges"
        const elements = Array.from(document.querySelectorAll('*'));
        const nodeDisplay = elements.find(el => {
          const text = el.textContent || '';
          return text.match(/(\d+)\s+nodes?\s+•\s+(\d+)\s+edges?/) &&
                 !text.includes('function');
        });

        if (nodeDisplay) {
          const match = nodeDisplay.textContent!.match(/(\d+)\s+nodes?\s+•\s+(\d+)\s+edges?/);
          if (match) {
            return {
              nodes: parseInt(match[1], 10),
              edges: parseInt(match[2], 10)
            };
          }
        }
        return null;
      });
    },

    waitForGraphUpdate: async (expectedNodes: number, expectedEdges: number) => {
      // First wait a bit for React to update
      await page.waitForTimeout(500);

      // Then poll for the expected state
      return page.waitForFunction(
        ({ expectedNodes, expectedEdges }: { expectedNodes: number; expectedEdges: number }): boolean => {
          // Check UI first (more reliable)
          const elements = Array.from(document.querySelectorAll('*'));
          const nodeDisplay = elements.find(el => {
            const text = el.textContent || '';
            return text.includes(`${expectedNodes} node`) &&
                   text.includes(`${expectedEdges} edge`);
          });

          if (nodeDisplay) return true;

          const win = window as ExtendedWindow;
          // Fallback: check Cytoscape instances
          const cy = win.cytoscapeInstance;
          if (cy && cy.nodes && cy.nodes().length === expectedNodes) {
            return true;
          }

          // Check multiple instances if they exist
          const instances = win.cytoscapeInstances;
          if (instances && Array.isArray(instances)) {
            return instances.some((cy: CytoscapeCore) =>
              cy && cy.nodes && cy.nodes().length === expectedNodes
            );
          }

          return false;
        },
        { expectedNodes, expectedEdges },
        { timeout: 5000 }
      );
    }
  };
}