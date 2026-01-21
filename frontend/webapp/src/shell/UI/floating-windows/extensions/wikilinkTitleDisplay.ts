/**
 * Wikilink Title Display Extension for CodeMirror
 *
 * Displays node titles instead of node IDs inside wikilinks [[nodeId]]
 * When cursor enters the wikilink, it reveals the raw nodeId for editing.
 */

import {
    Decoration,
    WidgetType,
    EditorView,
    type DecorationSet,
} from '@codemirror/view';
import { RangeSet, StateField, type EditorState, type Range, type Text, type Line, type Transaction } from '@codemirror/state';
import type { Core, NodeSingular } from 'cytoscape';

// Regex to match wikilinks: [[nodeId]]
const WIKILINK_REGEX: RegExp = /\[\[([^\]]+)\]\]/g;

/**
 * Check if a transaction's document changes involve bracket characters.
 * If no brackets changed, no wikilinks were affected.
 */
function transactionHasBracketChanges(transaction: Transaction): boolean {
    let hasBrackets: boolean = false;
    transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        const insertedText: string = inserted.toString();
        if (insertedText.includes('[') || insertedText.includes(']')) {
            hasBrackets = true;
        }
    });
    if (hasBrackets) return true;

    // Also check deleted text by examining the original document ranges
    transaction.changes.iterChanges((fromA, toA) => {
        if (fromA < toA) {
            const deletedText: string = transaction.startState.doc.sliceString(fromA, toA);
            if (deletedText.includes('[') || deletedText.includes(']')) {
                hasBrackets = true;
            }
        }
    });
    return hasBrackets;
}

/**
 * Check if a position is inside a wikilink in the document.
 * Returns the wikilink range if inside, null otherwise.
 */
function isInsideWikilink(doc: Text, pos: number): boolean {
    const line: Line = doc.lineAt(pos);
    const lineText: string = line.text;

    WIKILINK_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_REGEX.exec(lineText)) !== null) {
        const wikilinkStart: number = line.from + match.index;
        const wikilinkEnd: number = wikilinkStart + match[0].length;
        if (pos >= wikilinkStart && pos <= wikilinkEnd) {
            return true;
        }
    }
    return false;
}

/**
 * Check if cursor moved into or out of a wikilink region.
 * Returns true if the decoration for any wikilink needs to change visibility.
 */
function cursorCrossedWikilinkBoundary(doc: Text, oldPos: number, newPos: number): boolean {
    const wasInside: boolean = isInsideWikilink(doc, oldPos);
    const isNowInside: boolean = isInsideWikilink(doc, newPos);
    return wasInside !== isNowInside;
}

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
 * Find wikilinks and create decorations to display titles
 * Skips decoration when cursor is inside the wikilink
 */
function createWikilinkDecorations(state: EditorState): Range<Decoration>[] {
    const decorations: Range<Decoration>[] = [];
    const [cursor] = state.selection.ranges;

    // Process each line in visible range
    const doc: Text = state.doc;
    for (let i: number = 1; i <= doc.lines; i++) {
        const line: Line = doc.line(i);
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

    return decorations;
}

/**
 * CodeMirror StateField extension for wikilink title display
 */
export function wikilinkTitleDisplay(): StateField<DecorationSet> {
    return StateField.define<DecorationSet>({
        create(state) {
            return RangeSet.of(createWikilinkDecorations(state), true);
        },

        update(decorations, transaction) {
            const oldPos: number = transaction.startState.selection.main.from;
            const newPos: number = transaction.state.selection.main.from;
            const selectionChanged: boolean = oldPos !== newPos;

            // Fast path: no changes at all
            if (!transaction.docChanged && !selectionChanged) {
                return decorations;
            }

            // Check if doc change involves brackets (wikilink syntax)
            if (transaction.docChanged && transactionHasBracketChanges(transaction)) {
                return RangeSet.of(createWikilinkDecorations(transaction.state), true);
            }

            // Selection-only change: check if cursor entered/exited a wikilink
            if (selectionChanged) {
                if (cursorCrossedWikilinkBoundary(transaction.state.doc, oldPos, newPos)) {
                    return RangeSet.of(createWikilinkDecorations(transaction.state), true);
                }
            }

            // No wikilink-relevant changes - keep existing decorations
            return decorations;
        },

        provide(field) {
            return EditorView.decorations.from(field);
        },
    });
}
