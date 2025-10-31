/**
 * SearchService - Integration wrapper for ninja-keys command palette
 *
 * Features:
 * - Manages ninja-keys web component instance
 * - Builds searchable data from Cytoscape nodes
 * - Handles node selection and navigation
 * - Updates search data when nodes change
 */

import type { CytoscapeCore } from '@/graph-core';
import 'ninja-keys';

// Extend HTMLElement for ninja-keys custom element
interface NinjaAction {
  id: string;
  title: string;
  description?: string;
  handler?: () => void | { keepOpen: boolean };
}

interface NinjaKeysElement extends HTMLElement {
  data: NinjaAction[];
  open(): void;
  close(): void;
}

/**
 * SearchService manages the command palette search integration
 */
export class SearchService {
  private cy: CytoscapeCore;
  private ninjaKeys: NinjaKeysElement;
  private onNodeSelect: (nodeId: string) => void;

  constructor(
    cy: CytoscapeCore,
    onNodeSelect: (nodeId: string) => void
  ) {
    this.cy = cy;
    this.onNodeSelect = onNodeSelect;

    // Create ninja-keys element
    this.ninjaKeys = document.createElement('ninja-keys') as NinjaKeysElement;

    // Set theme to match dark mode
    if (document.documentElement.classList.contains('dark')) {
      this.ninjaKeys.classList.add('dark');
    }

    // Append to body (not container, so it overlays everything)
    document.body.appendChild(this.ninjaKeys);

    // Setup selection handler
    this.ninjaKeys.addEventListener('selected', (e: Event) => {
      console.log('[SearchService] Selected event fired:', e);
      const customEvent = e as CustomEvent;
      console.log('[SearchService] Event detail:', customEvent.detail);
      const nodeId = customEvent.detail?.id;
      console.log('[SearchService] Extracted nodeId:', nodeId);
      if (nodeId) {
        console.log('[SearchService] Calling onNodeSelect with:', nodeId);
        // Close the search modal before triggering selection to prevent focus issues
        this.close();
        this.onNodeSelect(nodeId);
      } else {
        console.warn('[SearchService] No nodeId found in event detail');
      }
    });

    // Build initial data
    this.updateSearchData();

    console.log('[SearchService] Initialized with ninja-keys');
  }

  /**
   * Open the search modal
   */
  open(): void {
    this.ninjaKeys.open();
  }

  /**
   * Close the search modal
   */
  close(): void {
    this.ninjaKeys.close();
  }

  /**
   * Update search data from current Cytoscape nodes
   */
  updateSearchData(): void {
    const nodes = this.cy.getCore().nodes();

    const searchData: NinjaAction[] = nodes.map((node) => {
      const nodeId = node.id();
      const label = node.data('label') || nodeId;
      const content = node.data('content') || '';

      // Extract first line of content for description (max 100 chars)
      const firstLine = content.split('\n')[0].trim();
      const description = firstLine.length > 100
        ? firstLine.substring(0, 100) + '...'
        : firstLine;

      return {
        id: nodeId,
        title: label,
        description: description || undefined,
        handler: () => {
          console.log('[SearchService] Handler called for nodeId:', nodeId);
          this.onNodeSelect(nodeId);
        }
      };
    });

    this.ninjaKeys.data = searchData;

    console.log(`[SearchService] Updated search data: ${searchData.length} nodes`);
  }

  /**
   * Update theme when dark mode changes
   */
  updateTheme(isDarkMode: boolean): void {
    if (isDarkMode) {
      this.ninjaKeys.classList.add('dark');
    } else {
      this.ninjaKeys.classList.remove('dark');
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.ninjaKeys.parentNode) {
      this.ninjaKeys.parentNode.removeChild(this.ninjaKeys);
    }
    console.log('[SearchService] Disposed');
  }
}
