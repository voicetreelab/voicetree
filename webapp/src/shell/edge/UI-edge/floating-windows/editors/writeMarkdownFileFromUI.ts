import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

export const WORKFLOW_INJECTION_WRITER_ID = 'workflow-injection'

export async function writeMarkdownFileFromUI(
    nodeId: NodeIdAndFilePath,
    body: string,
    writerId: string,
): Promise<void> {
    await window.electronAPI?.main.writeMarkdownFile(nodeId, body, writerId)
}
