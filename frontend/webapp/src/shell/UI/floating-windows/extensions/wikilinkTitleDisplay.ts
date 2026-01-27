/**
 * Wikilink Title Display Extension for CodeMirror
 *
 * Displays node titles instead of node IDs inside wikilinks [[nodeId]]
 * When cursor enters the wikilink, it reveals the raw nodeId for editing.
 *
 * Uses ViewPlugin pattern for:
 * - Viewport-only rendering (only decorates visible wikilinks)
 * - Debounced updates (avoids rebuilding on every keystroke)
 */

import {
    Decoration,
    WidgetType,
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

// Debounce delay for decoration updates (ms)
const DEBOUNCE_DELAY_MS: number = 50;

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
 * Widget that displays a node title instead of its ID.
 * Clickable - navigates to the resolved node on click.
 */
class WikilinkTitleWidget extends WidgetType {
    readonly title: string;
    readonly rawLinkText: string;
    readonly resolvedNodeId: string;

    constructor(title: string, rawLinkText: string, resolvedNodeId: string) {
        super();
        this.title = title;
        this.rawLinkText = rawLinkText;
        this.resolvedNodeId = resolvedNodeId;
    }

    eq(other: WikilinkTitleWidget): boolean {
        return other.title === this.title && other.resolvedNodeId === this.resolvedNodeId;
    }

    toDOM(): HTMLElement {
        const span: HTMLSpanElement = document.createElement('span');
        span.className = 'cm-wikilink-title';
        span.textContent = this.title;
        span.title = this.rawLinkText; // Show raw wikilink path on hover

        // Ensure the span can receive pointer events (CodeMirror may block them otherwise)
        span.style.pointerEvents = 'auto';

        // Use mousedown instead of click - fires before CodeMirror's event handling
        // which can intercept click events on replace decorations
        span.addEventListener('mousedown', (event: MouseEvent) => {
            // Only handle left mouse button clicks
            if (event.button !== 0) return;

            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent('voicetree-navigate', {
                detail: { nodeId: this.resolvedNodeId }
            }));
        });

        return span;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Find wikilinks in visible ranges and create decorations to display titles.
 * Only processes lines within the provided visible ranges (viewport optimization).
 * Skips decoration when cursor is inside the wikilink.
 */
function buildViewportDecorations(view: EditorView): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const state: EditorView['state'] = view.state;
    const [cursor] = state.selection.ranges;

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

                // Skip if cursor is inside or adjacent to this wikilink
                if (cursor.from >= wikilinkStart && cursor.from <= wikilinkEnd) {
                    continue;
                }
                if (cursor.to >= wikilinkStart && cursor.to <= wikilinkEnd) {
                    continue;
                }

                // Look up node using fuzzy matching - returns title and resolved ID
                const nodeMatch: WikilinkNodeMatch | null = findNodeForWikilink(linkText);
                if (!nodeMatch) {
                    continue; // No decoration needed - show raw link text
                }

                // Create decoration to replace the link text with title widget
                // Keep the [[ and ]] visible, only replace the inner link text
                const innerStart: number = wikilinkStart + 2; // After [[
                const innerEnd: number = wikilinkEnd - 2; // Before ]]

                const decoration: Decoration = Decoration.replace({
                    widget: new WikilinkTitleWidget(nodeMatch.title, linkText, nodeMatch.resolvedId),
                });

                decorations.push(decoration.range(innerStart, innerEnd));
            }
        }
    }

    return RangeSet.of(decorations, true);
}

/**
 * ViewPlugin class for wikilink title display with debouncing
 */
class WikilinkTitlePlugin {
    decorations: DecorationSet;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingView: EditorView | null = null;

    constructor(view: EditorView) {
        this.decorations = buildViewportDecorations(view);
    }

    update(update: ViewUpdate): void {
        // Always rebuild immediately for selection changes (cursor entered/exited wikilink)
        // This ensures the raw ID is shown when editing
        if (update.selectionSet && !update.docChanged) {
            this.decorations = buildViewportDecorations(update.view);
            return;
        }

        // For doc changes, debounce to avoid rebuilding on every keystroke
        if (update.docChanged || update.viewportChanged) {
            this.scheduleRebuild(update.view);
        }
    }

    private scheduleRebuild(view: EditorView): void {
        this.pendingView = view;

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            if (this.pendingView) {
                this.decorations = buildViewportDecorations(this.pendingView);
                this.pendingView.requestMeasure(); // Schedule DOM update without creating transaction
                this.pendingView = null;
            }
            this.debounceTimer = null;
        }, DEBOUNCE_DELAY_MS);
    }

    destroy(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
    }
}

/**
 * CodeMirror ViewPlugin extension for wikilink title display
 * Uses viewport-only rendering and debounced updates for performance.
 */
export function wikilinkTitleDisplay(): ViewPlugin<WikilinkTitlePlugin> {
    return ViewPlugin.fromClass(WikilinkTitlePlugin, {
        decorations: (plugin) => plugin.decorations,
    });
}
