/**
 * Wikilink Autocomplete Extension for CodeMirror
 *
 * Provides autocomplete suggestions when typing wikilinks ([[...]])
 * - Triggers on [[ or when cursor is inside [[...]]
 * - Shows nodes ordered by recency (recently visited first)
 * - Filters as user types
 * - Inserts relative path (from watched folder) on selection
 */

import {
    autocompletion,
    type CompletionContext,
    type CompletionResult,
    type Completion,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { Core, NodeSingular, NodeCollection } from 'cytoscape';
import { getRecentlyVisited } from '@/shell/edge/UI-edge/state/RecentlyVisitedStore';
import { toRelativePath } from '@/shell/edge/UI-edge/state/WatchedFolderStore';

/**
 * Get Cytoscape instance from window
 */
function getCytoscapeInstance(): Core | undefined {
    return (window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance;
}

/**
 * Node data for autocomplete suggestions
 */
interface NodeCompletionData {
    id: string;
    title: string;
    firstLine: string;
}

/**
 * Get all visible nodes from Cytoscape, ordered by recency
 */
function getOrderedNodes(): NodeCompletionData[] {
    const cy: Core | undefined = getCytoscapeInstance();
    if (!cy) return [];

    const nodes: NodeCollection = cy.nodes();

    // Filter out shadow nodes and context nodes
    const visibleNodes: NodeCollection = nodes.filter(
        (node: NodeSingular) =>
            !node.data('isShadowNode') && !node.data('isContextNode')
    );

    // Map to completion data
    const nodeData: NodeCompletionData[] = [];
    visibleNodes.forEach((node: NodeSingular) => {
        const id: string = node.id();
        const label: string = (node.data('label') as string) ?? id;
        const content: string = (node.data('content') as string) ?? '';

        // Extract first line of content for description
        const firstLine: string = content.split('\n')[0].trim();

        nodeData.push({
            id,
            title: label,
            firstLine: firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine,
        });
    });

    // Sort by recency
    const recentlyVisited: string[] = getRecentlyVisited();
    const recentSet: Set<string> = new Set(recentlyVisited);

    return nodeData.sort((a: NodeCompletionData, b: NodeCompletionData) => {
        const aRecent: boolean = recentSet.has(a.id);
        const bRecent: boolean = recentSet.has(b.id);

        if (aRecent && !bRecent) return -1;
        if (!aRecent && bRecent) return 1;
        if (aRecent && bRecent) {
            return recentlyVisited.indexOf(a.id) - recentlyVisited.indexOf(b.id);
        }
        // For non-recent nodes, sort alphabetically by title
        return a.title.localeCompare(b.title);
    });
}

/**
 * Check if cursor is inside a wikilink [[...]] or just after [[
 * Returns the search text if inside a wikilink, null otherwise
 */
function getWikilinkContext(context: CompletionContext): { from: number; searchText: string } | null {
    const { state, pos } = context;
    const line: string = state.doc.lineAt(pos).text;
    const lineStart: number = state.doc.lineAt(pos).from;
    const cursorInLine: number = pos - lineStart;

    // Find the last [[ before cursor position in current line
    const beforeCursor: string = line.substring(0, cursorInLine);
    const lastOpenBracket: number = beforeCursor.lastIndexOf('[[');

    if (lastOpenBracket === -1) {
        return null;
    }

    // Check if there's a closing ]] between [[ and cursor
    const betweenBrackets: string = beforeCursor.substring(lastOpenBracket + 2);
    if (betweenBrackets.includes(']]')) {
        return null; // Cursor is after a closed wikilink
    }

    // We're inside an open wikilink
    const searchText: string = betweenBrackets;
    const from: number = lineStart + lastOpenBracket + 2;

    return { from, searchText };
}

/**
 * Wikilink completion source
 */
function wikilinkCompletionSource(context: CompletionContext): CompletionResult | null {
    const wikilinkContext: { from: number; searchText: string } | null = getWikilinkContext(context);

    if (!wikilinkContext) {
        return null;
    }

    const { from, searchText } = wikilinkContext;
    const lowerSearch: string = searchText.toLowerCase();

    // Get all nodes ordered by recency
    const allNodes: NodeCompletionData[] = getOrderedNodes();

    // Filter by search text (match against title or id)
    const filteredNodes: NodeCompletionData[] = searchText
        ? allNodes.filter(
              (node: NodeCompletionData) =>
                  node.title.toLowerCase().includes(lowerSearch) ||
                  node.id.toLowerCase().includes(lowerSearch)
          )
        : allNodes;

    // Convert to CodeMirror completion format
    // Insert relative path (from watched folder) instead of absolute path
    const options: Completion[] = filteredNodes.map((node: NodeCompletionData) => ({
        label: node.title,
        detail: node.firstLine !== node.title ? node.firstLine : undefined,
        apply: toRelativePath(node.id), // Insert relative path for wikilink
        type: 'text',
        boost: 0, // Maintain our custom order
    }));

    return {
        from,
        options,
        validFor: /^[^\]]*$/, // Valid until we hit ]
    };
}

/**
 * Create the wikilink autocompletion extension
 *
 * Features:
 * - Triggers on [[ or when typing inside [[...]]
 * - Shows nodes ordered by recency (most recently visited first)
 * - Filters as user types
 * - Inserts node ID on enter/tab
 * - Arrow keys to navigate
 */
export function wikilinkCompletion(): Extension {
    return autocompletion({
        override: [wikilinkCompletionSource],
        activateOnTyping: true,
        closeOnBlur: true,
        icons: false,
        optionClass: () => 'cm-wikilink-option',
        // Don't interfere with default behavior when not in a wikilink
        defaultKeymap: true,
    });
}
