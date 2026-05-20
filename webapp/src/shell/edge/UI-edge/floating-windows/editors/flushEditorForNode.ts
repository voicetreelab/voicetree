import * as O from 'fp-ts/lib/Option.js'
import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getEditorByNodeId } from '@/shell/edge/UI-edge/state/stores/EditorStore'
import { getEditorId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState'
import { writeMarkdownFileFromUI } from './writeMarkdownFileFromUI'
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

/**
 * Flush any pending editor content for a specific node.
 * Call before operations that need the latest content in graph state.
 *
 * This bypasses the 300ms debounce on editor autosave, ensuring the latest
 * editor content is written before another workflow reads from disk.
 *
 * Best-effort: if the node is missing from the graph (e.g. stale editor after
 * vault reload), logs a warning and returns instead of throwing.
 */
export async function flushEditorForNode(
    nodeId: NodeIdAndFilePath,
): Promise<void> {
    const editorOption: O.Option<EditorData> = getEditorByNodeId(nodeId)
    if (O.isNone(editorOption)) return  // No editor open, nothing to flush

    const editorId: string = getEditorId(editorOption.value)
    const editor: { dispose: () => void; focus?: () => void; getValue?: () => string } | undefined = vanillaFloatingWindowInstances.get(editorId)
    if (!editor?.getValue) return

    // Trigger immediate save (same as onChange callback but bypasses debounce)
    const content: string = editor.getValue()
    try {
        await writeMarkdownFileFromUI(nodeId, content, editorId)
    } catch (e: unknown) {
        console.warn('[flushEditorForNode] Could not flush editor — node may be missing from graph, proceeding anyway:', nodeId, e)
    }
}
