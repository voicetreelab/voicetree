import type {Core} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {Edge, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph';
import type {ProjectedEdge, ProjectedGraph, ProjectedNode} from '@vt/graph-state/contract';
import {type EditorId, getEditorId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import {type EditorData, vanillaFloatingWindowInstances} from '@/shell/edge/UI-edge/state/stores/UIAppState';
import {getEditorByNodeId} from "@/shell/edge/UI-edge/state/stores/EditorStore";
import {fromNodeToContentWithWikilinks} from '@vt/graph-model/markdown';
import {getAppendedSuffix, isAppendOnly, normalizeContentForEchoComparison} from "@vt/graph-model/graph";
import type {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {closeEditor} from './FloatingEditorCRUD';

// =============================================================================
// Update Floating Editors
// =============================================================================

function contentMatchesForEchoComparison(left: string, right: string): boolean {
    if (left === right) {
        return true;
    }
    if (isAppendOnly(left, right) || isAppendOnly(right, left)) {
        return false;
    }
    return normalizeContentForEchoComparison(left) === normalizeContentForEchoComparison(right);
}

function commonPrefixLength(left: string, right: string): number {
    const limit: number = Math.min(left.length, right.length);
    let index: number = 0;
    while (index < limit && left[index] === right[index]) {
        index += 1;
    }
    return index;
}

function getFocusedEditorAppendSuffix(
    currentEditorContent: string,
    prevContent: string,
    newContent: string,
): string {
    if (!currentEditorContent.startsWith(prevContent)) {
        return getAppendedSuffix(prevContent, newContent);
    }

    const externalAppend: string = newContent.slice(prevContent.length);
    const userExtension: string = currentEditorContent.slice(prevContent.length);
    const overlap: number = commonPrefixLength(userExtension, externalAppend);
    if (overlap === 0) {
        return externalAppend;
    }
    // An autosave echo manifests as a meaningful run of characters from the
    // user's saved typing showing up at the head of the daemon's reported
    // append. Coincidental overlaps (paragraph separators, a lone "#" header
    // marker that both sides happen to start with) are short / mostly
    // whitespace and should not be stripped — doing so eats the separator the
    // external change relies on. Require ≥2 non-whitespace overlap characters
    // before treating it as a real echo.
    const overlapStr: string = externalAppend.slice(0, overlap);
    const nonWhitespaceOverlap: number = overlapStr.replace(/\s/g, '').length;
    if (nonWhitespaceOverlap < 2) {
        return externalAppend;
    }
    return externalAppend.slice(overlap);
}

/**
 * Update floating editors based on graph delta
 * For each node upsert, check if there's an open editor and update its content
 * Editor shows content WITHOUT YAML - uses fromNodeToContentWithWikilinks
 */
export function updateFloatingEditors(
    cy: Core,
    delta: GraphDelta,
    suppressForSubscribers: readonly string[] = [],
): void {
    const suppressedEditors: ReadonlySet<string> = new Set(suppressForSubscribers);

    for (const nodeDelta of delta) {
        if (nodeDelta.type === 'UpsertNode') {
            const nodeId: string = nodeDelta.nodeToUpsert.absoluteFilePathIsID;
            const newContent: string = fromNodeToContentWithWikilinks(nodeDelta.nodeToUpsert);

            // Check if there's an open editor for this node
            const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId);

            if (O.isSome(editorOption)) {
                const editor: EditorData = editorOption.value;
                const editorId: EditorId = getEditorId(editor);
                if (suppressedEditors.has(editorId)) {
                    continue;
                }

                // Get the editor instance from vanillaFloatingWindowInstances
                const editorInstance: { dispose: () => void; focus?: () => void } | undefined =
                    vanillaFloatingWindowInstances.get(editorId);

                if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
                    const cmEditor: CodeMirrorEditorView = editorInstance as CodeMirrorEditorView;
                    const currentEditorContent: string = cmEditor.getValue();

                    if (contentMatchesForEchoComparison(currentEditorContent, newContent)) {
                        continue;
                    }

                    // Append-only changes (e.g., wikilink edge from child creation)
                    // are safe to apply regardless of focus or unsaved edits —
                    // they only add to the end, so they won't clobber typing.
                    if (O.isSome(nodeDelta.previousNode)) {
                        const prevContent: string = fromNodeToContentWithWikilinks(nodeDelta.previousNode.value);
                        if (isAppendOnly(prevContent, newContent)) {
                            // If the editor already contains all of newContent
                            // (typically because it has typed past an autosave
                            // whose echo we're seeing now), this delta is
                            // redundant — re-appending the suffix would
                            // duplicate it.
                            if (
                                currentEditorContent.startsWith(newContent) ||
                                contentMatchesForEchoComparison(currentEditorContent, newContent)
                            ) {
                                continue;
                            }
                            const suffix: string = getFocusedEditorAppendSuffix(currentEditorContent, prevContent, newContent);
                            if (suffix.length > 0 && !currentEditorContent.endsWith(suffix)) {
                                // appendAtEnd inserts the suffix at the doc tail
                                // without moving the cursor. Using setValue here
                                // would reset the cursor to end-of-doc, splitting
                                // the user's in-flight typing across the suffix.
                                cmEditor.appendAtEnd(suffix);
                            }
                            continue;
                        }
                    }

                    if (O.isSome(nodeDelta.previousNode)) {
                        const prevContent: string = fromNodeToContentWithWikilinks(nodeDelta.previousNode.value);
                        if (!contentMatchesForEchoComparison(currentEditorContent, prevContent)) {
                            continue;
                        }
                    }

                    cmEditor.setValue(newContent);
                }
            }
        } else if (nodeDelta.type === 'DeleteNode') {
            // Handle node deletion - close the editor if open
            const nodeId: string = nodeDelta.nodeId;
            const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId);

            if (O.isSome(editorOption)) {
                if (suppressedEditors.has(getEditorId(editorOption.value))) {
                    continue;
                }
                //console.log('[FloatingEditorManager-v2] Closing editor for deleted node:', nodeId);
                closeEditor(cy, editorOption.value);
            }
        }
    }
}

/**
 * Build a synthetic GraphNode from a ProjectedNode + that node's outgoing edges
 * so the existing `fromNodeToContentWithWikilinks` and append-only diff logic
 * can compute editor content. ProjectedGraph is the only form available on the
 * SSE path post-7831f39c, so we adapt at this seam rather than threading
 * GraphNodes through the daemon→renderer wire.
 */
function projectedNodeToSyntheticGraphNode(
    node: ProjectedNode,
    edges: readonly ProjectedEdge[],
): GraphNode {
    const outgoingEdges: readonly Edge[] = edges
        .filter((edge: ProjectedEdge) => edge.source === node.id && edge.kind === 'real')
        .map((edge: ProjectedEdge) => ({
            targetId: edge.target as NodeIdAndFilePath,
            label: edge.label ?? '',
        }));

    return {
        kind: 'leaf',
        outgoingEdges,
        absoluteFilePathIsID: node.id as NodeIdAndFilePath,
        contentWithoutYamlOrLinks: node.content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            ...(node.isContextNode === true ? { isContextNode: true } : {}),
        },
    };
}

/**
 * Update floating editors from a ProjectedGraph snapshot delivered by the
 * daemon SSE channel. Diffs the new projection against the previous one to
 * synthesize the per-node UpsertNode deltas that `updateFloatingEditors` needs,
 * then defers to the existing append-only / focus-aware merge pipeline.
 *
 * @param cy            Cytoscape core (for delete-side editor close)
 * @param graph         The new projected graph snapshot
 * @param previousGraph The prior snapshot (or null on first delivery)
 */
export function updateFloatingEditorsFromProjectedGraph(
    cy: Core,
    graph: ProjectedGraph,
    previousGraph: ProjectedGraph | null,
): void {
    const previousNodeById: Map<string, ProjectedNode> = new Map();
    if (previousGraph) {
        for (const prev of previousGraph.nodes) {
            if (prev.kind === 'file') previousNodeById.set(prev.id, prev);
        }
    }

    const delta: GraphDelta = [];
    for (const node of graph.nodes) {
        if (node.kind !== 'file') continue;

        // Skip nodes without an open editor — keeps this hot-path proportional
        // to the number of pinned editors, not the size of the graph.
        if (O.isNone(getEditorByNodeId(node.id))) continue;

        const newGraphNode: GraphNode = projectedNodeToSyntheticGraphNode(node, graph.edges);
        const prevProjected: ProjectedNode | undefined = previousNodeById.get(node.id);
        const previousNode: O.Option<GraphNode> = prevProjected
            ? O.some(projectedNodeToSyntheticGraphNode(prevProjected, previousGraph?.edges ?? []))
            : O.none;

        delta.push({
            type: 'UpsertNode',
            nodeToUpsert: newGraphNode,
            previousNode,
        });
    }

    if (delta.length > 0) {
        updateFloatingEditors(cy, delta, graph.suppressForSubscribers ?? []);
    }
}
