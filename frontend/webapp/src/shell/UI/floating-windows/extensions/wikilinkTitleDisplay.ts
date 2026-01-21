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
 * Look up a node's title from Cytoscape by its ID
 * Returns null if node not found
 */
function getNodeTitle(nodeId: string): string | null {
    const cy: Core | undefined = getCytoscapeInstance();
    if (!cy) return null;

    const node: NodeSingular = cy.getElementById(nodeId);
    if (node.empty()) return null;

    return (node.data('label') as string) ?? null;
}

/**
 * Widget that displays a node title instead of its ID
 */
class WikilinkTitleWidget extends WidgetType {
    readonly title: string;
    readonly nodeId: string;

    constructor(title: string, nodeId: string) {
        super();
        this.title = title;
        this.nodeId = nodeId;
    }

    eq(other: WikilinkTitleWidget): boolean {
        return other.title === this.title && other.nodeId === this.nodeId;
    }

    toDOM(): HTMLElement {
        const span: HTMLSpanElement = document.createElement('span');
        span.className = 'cm-wikilink-title';
        span.textContent = this.title;
        span.title = this.nodeId; // Show nodeId on hover
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
                const nodeId: string = match[1];
                const wikilinkStart: number = line.from + match.index;
                const wikilinkEnd: number = wikilinkStart + match[0].length;

                // Skip if cursor is inside or adjacent to this wikilink
                if (cursor.from >= wikilinkStart && cursor.from <= wikilinkEnd) {
                    continue;
                }
                if (cursor.to >= wikilinkStart && cursor.to <= wikilinkEnd) {
                    continue;
                }

                // Look up title - fallback to nodeId if not found
                const title: string | null = getNodeTitle(nodeId);
                if (!title) {
                    continue; // No decoration needed - show raw ID
                }

                // Create decoration to replace the nodeId text with title widget
                // Keep the [[ and ]] visible, only replace the inner nodeId
                const innerStart: number = wikilinkStart + 2; // After [[
                const innerEnd: number = wikilinkEnd - 2; // Before ]]

                const decoration: Decoration = Decoration.replace({
                    widget: new WikilinkTitleWidget(title, nodeId),
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
                this.pendingView.dispatch({}); // Trigger re-render with new decorations
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
