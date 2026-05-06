import type {Core} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {GraphDelta} from '@vt/graph-model/pure/graph';
import {type EditorId, getEditorId} from '@/shell/edge/UI-edge/floating-windows/types';
import {type EditorData, vanillaFloatingWindowInstances} from '@/shell/edge/UI-edge/state/UIAppState';
import {getEditorByNodeId} from "@/shell/edge/UI-edge/state/EditorStore";
import {fromNodeToContentWithWikilinks} from '@vt/graph-model/pure/graph/markdown-writing/node_to_markdown';
import {getAppendedSuffix, isAppendOnly} from "@vt/graph-model/pure/graph/contentChangeDetection";
import type {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import {closeEditor} from './FloatingEditorCRUD';

// =============================================================================
// Update Floating Editors
// =============================================================================

/**
 * Update floating editors based on graph delta
 * For each node upsert, check if there's an open editor and update its content
 * Editor shows content WITHOUT YAML - uses fromNodeToContentWithWikilinks
 */
export function updateFloatingEditors(cy: Core, delta: GraphDelta, skipFocusGuard: boolean = false): void {
    for (const nodeDelta of delta) {
        if (nodeDelta.type === 'UpsertNode') {
            const nodeId: string = nodeDelta.nodeToUpsert.absoluteFilePathIsID;
            const newContent: string = fromNodeToContentWithWikilinks(nodeDelta.nodeToUpsert);

            // Check if there's an open editor for this node
            const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId);

            if (O.isSome(editorOption)) {
                const editor: EditorData = editorOption.value;
                const editorId: EditorId = getEditorId(editor);

                // Get the editor instance from vanillaFloatingWindowInstances
                const editorInstance: { dispose: () => void; focus?: () => void } | undefined =
                    vanillaFloatingWindowInstances.get(editorId);

                if (editorInstance && 'setValue' in editorInstance && 'getValue' in editorInstance) {
                    const cmEditor: CodeMirrorEditorView = editorInstance as CodeMirrorEditorView;
                    const currentEditorContent: string = cmEditor.getValue();

                    if (currentEditorContent === newContent) {
                        continue;
                    }

                    // Append-only changes (e.g., wikilink edge from child creation)
                    // are safe to apply regardless of focus or unsaved edits —
                    // they only add to the end, so they won't clobber typing.
                    if (O.isSome(nodeDelta.previousNode)) {
                        const prevContent: string = fromNodeToContentWithWikilinks(nodeDelta.previousNode.value);
                        if (isAppendOnly(prevContent, newContent)) {
                            const suffix: string = getAppendedSuffix(prevContent, newContent);
                            if (!currentEditorContent.endsWith(suffix)) {
                                cmEditor.setValue(currentEditorContent + suffix);
                            }
                            continue;
                        }
                    }

                    // Skip non-append programmatic updates while the user is
                    // actively typing — the autosave round-trip would clobber
                    // newer characters.  In daemon mode, echo filtering happens
                    // at the SSE layer so all deltas reaching here are external;
                    // skipFocusGuard bypasses this guard for those.
                    if (!skipFocusGuard && cmEditor.isFocused()) {
                        continue;
                    }

                    if (O.isSome(nodeDelta.previousNode)) {
                        const prevContent: string = fromNodeToContentWithWikilinks(nodeDelta.previousNode.value);
                        if (currentEditorContent !== prevContent) {
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
                //console.log('[FloatingEditorManager-v2] Closing editor for deleted node:', nodeId);
                closeEditor(cy, editorOption.value);
            }
        }
    }
}
