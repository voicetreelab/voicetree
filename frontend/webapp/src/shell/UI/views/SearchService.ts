/**
 * SearchService - Integration wrapper for ninja-keys command palette
 *
 * Features:
 * - Manages ninja-keys web component instance
 * - Builds searchable data from Cytoscape nodes
 * - Handles node selection and navigation
 * - Updates search data when nodes change
 */

import type { Core, NodeCollection, NodeSingular } from 'cytoscape';
import 'ninja-keys';
import { getRecentlyVisited } from '@/shell/edge/UI-edge/state/RecentlyVisitedStore';
import type { GraphDelta } from '@/pure/graph';

// Extend HTMLElement for ninja-keys custom element
interface NinjaAction {
  id: string;
  title: string;
  section?: string;
  hotkey?: string;
  description?: string;
  keywords?: string;
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
  private cy: Core;
  private ninjaKeys: NinjaKeysElement;
  private onNodeSelect: (nodeId: string) => void;

  constructor(
    cy: Core,
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

    // Build initial data
    this.updateSearchData();

    //console.log('[SearchService] Initialized with ninja-keys');
  }

  /**
   * Open the search modal
   */
  open(): void {
    this.reorderByRecency();
    this.ninjaKeys.open();
  }

  /**
   * Re-sort existing search data by recency.
   * O(N log N) sort on existing data - no Cytoscape queries.
   * Called on open() to reflect latest recently visited state.
   */
  private reorderByRecency(): void {
    const currentData: NinjaAction[] = this.ninjaKeys.data;
    if (currentData.length === 0) return;

    const recentlyVisited: string[] = getRecentlyVisited();
    const recentSet: Set<string> = new Set(recentlyVisited);

    // Strip existing hotkeys before re-sorting (they'll be re-added based on new order)
    const strippedData: NinjaAction[] = currentData.map((action: NinjaAction) => {
      const { hotkey: _, ...rest } = action;
      return rest;
    });

    // Sort by recency
    const sorted: NinjaAction[] = strippedData.sort((a: NinjaAction, b: NinjaAction) => {
      const aRecent: boolean = recentSet.has(a.id);
      const bRecent: boolean = recentSet.has(b.id);

      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      if (aRecent && bRecent) {
        return recentlyVisited.indexOf(a.id) - recentlyVisited.indexOf(b.id);
      }
      return 0;
    });

    // Add sections and recency indicators
    const prefixed: NinjaAction[] = sorted.map((action: NinjaAction) => {
      const recentIndex: number = recentlyVisited.indexOf(action.id);
      if (recentIndex >= 0) {
        // Use cmd+N format so ninja-keys displays the hint but doesn't register plain number keys
        // HotkeyManager handles the actual Cmd+1-5 shortcuts
        return { ...action, hotkey: `cmd+${recentIndex + 1}`, section: 'Recently Active' };
      }
      return { ...action, section: 'All Nodes' };
    });

    this.ninjaKeys.data = prefixed;
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
      // todo, make this take a Graph object instead.
    const nodes: NodeCollection = this.cy.nodes();

    // Filter out shadow nodes (internal UI nodes for editors/terminals) and context nodes
    const visibleNodes: NodeCollection = nodes.filter((node) =>
      !node.data('isShadowNode') && !node.data('isContextNode')
    );

    const searchData: NinjaAction[] = visibleNodes.map((node) => {
      const nodeId: string = node.id();
      const label: string = node.data('label') as string ?? nodeId;
      const content: string = node.data('content') as string ?? '';

      // Extract first line of content for description (max 300 chars)
      const firstLine: string = content.split('\n')[0].trim();
      const description: string = firstLine.length > 300
        ? firstLine.substring(0, 300) + '...'
        : firstLine;

      return {
        id: nodeId,
        title: label,
        description: description ?? undefined,
        keywords: content.substring(0, 500),
        handler: () => {
          //console.log('[SearchService] Handler called for nodeId:', nodeId);
          this.onNodeSelect(nodeId);
        }
      };
    });

    // Sort by recency: recently visited nodes appear first
    const recentlyVisited: string[] = getRecentlyVisited();
    const recentSet: Set<string> = new Set(recentlyVisited);

    const sortedSearchData: NinjaAction[] = searchData.sort((a: NinjaAction, b: NinjaAction) => {
      const aRecent: boolean = recentSet.has(a.id);
      const bRecent: boolean = recentSet.has(b.id);

      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      if (aRecent && bRecent) {
        // Both recent: order by recency (earlier in array = more recent)
        return recentlyVisited.indexOf(a.id) - recentlyVisited.indexOf(b.id);
      }
      // Neither recent: keep original order
      return 0;
    });

    // Add sections and recency indicators
    const prefixedSearchData: NinjaAction[] = sortedSearchData.map((action: NinjaAction) => {
      const recentIndex: number = recentlyVisited.indexOf(action.id);
      if (recentIndex >= 0) {
        // Use cmd+N format so ninja-keys displays the hint but doesn't register plain number keys
        // HotkeyManager handles the actual Cmd+1-5 shortcuts
        return { ...action, hotkey: `cmd+${recentIndex + 1}`, section: 'Recently Active' };
      }
      return { ...action, section: 'All Nodes' };
    });

    this.ninjaKeys.data = prefixedSearchData;

    //console.log(`[SearchService] Updated search data: ${searchData.length} nodes`);
  }

  /**
   * Incrementally update search data based on a graph delta.
   * O(D) where D is the number of deltas, instead of O(N) for all nodes.
   * Only updates/adds/removes the specific nodes affected by the delta.
   */
  updateSearchDataIncremental(delta: GraphDelta): void {
    if (delta.length === 0) return;

    const currentData: NinjaAction[] = [...this.ninjaKeys.data];

    for (const nodeDelta of delta) {
      if (nodeDelta.type === 'UpsertNode') {
        const node: NodeSingular | undefined = this.cy.getElementById(nodeDelta.nodeToUpsert.absoluteFilePathIsID);
        if (!node || node.empty() || node.data('isShadowNode') || node.data('isContextNode')) continue;

        const nodeId: string = node.id();
        const label: string = node.data('label') as string ?? nodeId;
        const content: string = node.data('content') as string ?? '';

        const firstLine: string = content.split('\n')[0].trim();
        const description: string = firstLine.length > 300
          ? firstLine.substring(0, 300) + '...'
          : firstLine;

        const newAction: NinjaAction = {
          id: nodeId,
          title: label,
          description: description ?? undefined,
          keywords: content.substring(0, 500),
          handler: () => {
            //console.log('[SearchService] Handler called for nodeId:', nodeId);
            this.onNodeSelect(nodeId);
          }
        };

        // Find existing item by id and update, or append
        const existingIndex: number = currentData.findIndex((action: NinjaAction) => action.id === nodeId);
        if (existingIndex >= 0) {
          currentData[existingIndex] = newAction;
        } else {
          currentData.push(newAction);
        }
      } else if (nodeDelta.type === 'DeleteNode') {
        // Remove the deleted node from the data
        const deleteIndex: number = currentData.findIndex((action: NinjaAction) => action.id === nodeDelta.nodeId);
        if (deleteIndex >= 0) {
          currentData.splice(deleteIndex, 1);
        }
      }
    }

    this.ninjaKeys.data = currentData;
    //console.log(`[SearchService] Incremental update: ${delta.length} deltas processed`);
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
    //console.log('[SearchService] Disposed');
  }
}
