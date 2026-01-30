import * as O from 'fp-ts/lib/Option.js'
import type { Core } from 'cytoscape'
import type { NodeIdAndFilePath } from '@/pure/graph'
import { getEditorByNodeId } from '@/shell/edge/UI-edge/state/EditorStore'
import { getEditorId } from '@/shell/edge/UI-edge/floating-windows/types'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'
import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView'
import { modifyNodeContentFromUI } from './modifyNodeContentFromFloatingEditor'
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

/**
 * Flush any pending editor content for a specific node.
 * Call before operations that need the latest content in graph state.
 *
 * This bypasses the 300ms debounce on editor autosave, ensuring the
 * in-memory graph state is immediately updated with the editor's content.
 */
export async function flushEditorForNode(
    nodeId: NodeIdAndFilePath,
    cy: Core
): Promise<void> {
    const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId)
    if (O.isNone(editorOption)) return  // No editor open, nothing to flush

    const editorId: string = getEditorId(editorOption.value)
    const editor: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(editorId)
    if (!editor || !('getValue' in editor)) return

    // Trigger immediate save (same as onChange callback but bypasses debounce)
    const content: string = (editor as CodeMirrorEditorView).getValue()
    await modifyNodeContentFromUI(nodeId, content, cy)
}
