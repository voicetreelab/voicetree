import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

export const WORKFLOW_INJECTION_WRITER_ID = 'workflow-injection'

export async function writeMarkdownFileFromUI(
    nodeId: NodeIdAndFilePath,
    body: string,
    writerId: string,
): Promise<{ ok: true; absolutePath: string; preservedSuffix: string | null } | undefined> {
    return await window.hostAPI?.main.writeMarkdownFile(nodeId, body, writerId)
}
