import * as O from 'fp-ts/lib/Option.js'
import type { GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { fromNodeToContentWithWikilinks } from '@vt/graph-model/markdown'
import { getEditorByNodeId } from '@/shell/edge/UI-edge/state/stores/EditorStore'
import { getEditorId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState'
import { writeMarkdownFileFromUI } from './writeMarkdownFileFromUI'
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

const FLUSH_GRAPH_TIMEOUT_MS = 5_000
const FLUSH_GRAPH_POLL_MS = 25

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function graphNodeMatchesEditorContent(node: GraphNode | undefined, content: string): boolean {
    return node !== undefined && fromNodeToContentWithWikilinks(node) === content
}

async function waitForDaemonGraphContent(
    nodeId: NodeIdAndFilePath,
    content: string,
): Promise<void> {
    const getNode = window.hostAPI?.main.getNode
    if (!getNode) {
        throw new Error('hostAPI.main.getNode is unavailable; cannot confirm flushed editor content in daemon graph')
    }

    const deadline = performance.now() + FLUSH_GRAPH_TIMEOUT_MS
    while (performance.now() < deadline) {
        const node: GraphNode | undefined = await getNode(nodeId)
        if (graphNodeMatchesEditorContent(node, content)) return
        await delay(FLUSH_GRAPH_POLL_MS)
    }

    throw new Error(`Timed out waiting for daemon graph to contain flushed editor content for ${nodeId}`)
}

/**
 * Flush any pending editor content for a specific node.
 * Call before operations that need the latest content in graph state.
 *
 * This bypasses the autosave debounce and waits until the daemon graph reflects
 * the write, so downstream context snapshots and structural operations do not
 * read stale in-memory node content.
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
    if (!window.hostAPI?.main.writeMarkdownFile) {
        throw new Error('hostAPI.main.writeMarkdownFile is unavailable; cannot flush editor content')
    }
    await writeMarkdownFileFromUI(nodeId, content, editorId)
    await waitForDaemonGraphContent(nodeId, content)
}
