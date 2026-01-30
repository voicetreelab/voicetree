/**
 * Wikilink Title Display Extension for CodeMirror
 *
 * Displays node titles instead of node IDs inside wikilinks [[nodeId]]
 * When cursor enters the wikilink, it reveals the raw nodeId for editing.
 *
 * Uses Mark decorations (not Replace) to avoid DOM restructuring:
 * - Marks add classes/attributes to existing text nodes
 * - CSS ::after pseudo-element displays the title
 * - No DOM churn = no cursor position issues during typing
 */

import {
    Decoration,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    type DecorationSet,
} from '@codemirror/view';
import { RangeSet, type Range, type Line } from '@codemirror/state';
import type { Core, NodeSingular } from 'cytoscape';
import { linkMatchScore, getPathComponents } from '@/pure/graph/markdown-parsing/extract-edges';

// Regex to match wikilinks: [[nodeId]]
const WIKILINK_REGEX: RegExp = /\[\[([^\]]+)\]\]/g;

/**
 * Get Cytoscape instance from window
 */
function getCytoscapeInstance(): Core | undefined {
    return (window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance;
}

/**
 * Result of finding a node for a wikilink
 */
interface WikilinkNodeMatch {
    readonly title: string;
    readonly resolvedId: string;
}

/**
 * Find node matching the wikilink text using fuzzy suffix matching.
 * Uses linkMatchScore for path resolution (same logic as edge resolution).
 * Returns title and resolved ID for navigation.
 */
function findNodeForWikilink(linkText: string): WikilinkNodeMatch | null {
    const cy: Core | undefined = getCytoscapeInstance();
    if (!cy) return null;

    // Try exact match first
    const exactNode: NodeSingular = cy.getElementById(linkText);
    if (!exactNode.empty()) {
        const title: string | null = (exactNode.data('label') as string) ?? null;
        return title ? { title, resolvedId: linkText } : null;
    }

    // Use linkMatchScore for fuzzy suffix matching (same logic as edge resolution)
    const linkComponents: readonly string[] = getPathComponents(linkText);
    if (linkComponents.length === 0) return null;

    // Track best match using mutable state within forEach
    const match: { node: NodeSingular | null; score: number } = { node: null, score: 0 };

    cy.nodes().forEach((n: NodeSingular) => {
        if (n.data('isShadowNode') || n.data('isContextNode')) return;

        const score: number = linkMatchScore(linkText, n.id());
        // Accept match only if ALL link components matched (same rule as findBestMatchingNode)
        if (score >= linkComponents.length && score > match.score) {
            match.score = score;
            match.node = n;
        }
    });

    if (!match.node) return null;

    const title: string | null = (match.node.data('label') as string) ?? null;
    return title ? { title, resolvedId: match.node.id() } : null;
}

/**
 * Find wikilinks in visible ranges and create mark decorations.
 * Mark decorations add classes/attributes without changing DOM structure.
 * Adds 'editing' class when cursor is inside the wikilink.
 */
function buildViewportDecorations(view: EditorView): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const state = view.state;
    const cursor = state.selection.main;

    // Only iterate lines in visible ranges (viewport optimization)
    for (const { from, to } of view.visibleRanges) {
        const startLine: number = state.doc.lineAt(from).number;
        const endLine: number = state.doc.lineAt(to).number;

        for (let lineNum: number = startLine; lineNum <= endLine; lineNum++) {
            const line: Line = state.doc.line(lineNum);
            const lineText: string = line.text;

            // Find all wikilinks in this line
            let match: RegExpExecArray | null;
            WIKILINK_REGEX.lastIndex = 0; // Reset regex state

            while ((match = WIKILINK_REGEX.exec(lineText)) !== null) {
                const linkText: string = match[1];
                const wikilinkStart: number = line.from + match.index;
                const wikilinkEnd: number = wikilinkStart + match[0].length;

                // Check if cursor is inside this wikilink
                const cursorInside: boolean =
                    cursor.from >= wikilinkStart && cursor.from <= wikilinkEnd ||
                    cursor.to >= wikilinkStart && cursor.to <= wikilinkEnd;

                // Look up node using fuzzy matching - returns title and resolved ID
                const nodeMatch: WikilinkNodeMatch | null = findNodeForWikilink(linkText);
                if (!nodeMatch) {
                    continue; // No decoration needed - show raw link text
                }

                // Mark the inner content (between [[ and ]])
                const innerStart: number = wikilinkStart + 2; // After [[
                const innerEnd: number = wikilinkEnd - 2; // Before ]]

                // Use mark decoration - doesn't change DOM structure
                const decoration: Decoration = Decoration.mark({
                    class: cursorInside ? 'cm-wikilink-title cm-wikilink-editing' : 'cm-wikilink-title',
                    attributes: {
                        'data-title': nodeMatch.title,
                        'data-node-id': nodeMatch.resolvedId,
                    },
                });

                decorations.push(decoration.range(innerStart, innerEnd));
            }
        }
    }

    return RangeSet.of(decorations, true);
}

/**
 * ViewPlugin class for wikilink title display
 * Rebuilds on selection and doc changes, but mark decorations
 * don't cause DOM restructuring so cursor remains stable.
 */
class WikilinkTitlePlugin {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = buildViewportDecorations(view);
    }

    update(update: ViewUpdate): void {
        // Rebuild when selection changes (to toggle editing class)
        // or when document/viewport changes
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
            this.decorations = buildViewportDecorations(update.view);
        }
    }
}

/**
 * Click handler for wikilink navigation.
 * Uses event delegation - listens on editor, checks if target is a wikilink.
 */
const wikilinkClickHandler = EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView): boolean {
        // Only handle left clicks
        if (event.button !== 0) return false;

        const target = event.target as HTMLElement;

        // Check if clicked on a wikilink title chip
        if (!target.classList.contains('cm-wikilink-title')) return false;

        // Don't navigate if in editing mode (cursor inside)
        if (target.classList.contains('cm-wikilink-editing')) return false;

        const nodeId = target.dataset.nodeId;
        if (!nodeId) return false;

        event.preventDefault();
        event.stopPropagation();

        window.dispatchEvent(new CustomEvent('voicetree-navigate', {
            detail: { nodeId }
        }));

        return true;
    }
});

/**
 * CSS styles for wikilink title display.
 * Uses ::after pseudo-element to show title without changing DOM structure.
 */
const wikilinkStyles = EditorView.baseTheme({
    '.cm-wikilink-title': {
        // Hide the original node ID text
        fontSize: '0',
        // Container for the ::after chip
        position: 'relative',
    },
    '.cm-wikilink-title::after': {
        // Show the title from data attribute
        content: 'attr(data-title)',
        fontSize: '14px',
        // Chip styling
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        color: 'rgb(59, 130, 246)',
        padding: '1px 6px',
        borderRadius: '4px',
        cursor: 'pointer',
    },
    '.cm-wikilink-title:hover::after': {
        backgroundColor: 'rgba(59, 130, 246, 0.25)',
    },
    // When editing (cursor inside), show the original text
    '.cm-wikilink-title.cm-wikilink-editing': {
        fontSize: 'inherit',
    },
    '.cm-wikilink-title.cm-wikilink-editing::after': {
        display: 'none',
    },
});

/**
 * CodeMirror extension for wikilink title display.
 * Uses Mark decorations + CSS for stable cursor behavior.
 */
export function wikilinkTitleDisplay() {
    return [
        ViewPlugin.fromClass(WikilinkTitlePlugin, {
            decorations: (plugin) => plugin.decorations,
        }),
        wikilinkClickHandler,
        wikilinkStyles,
    ];
}
