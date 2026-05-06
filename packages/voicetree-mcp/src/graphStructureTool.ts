import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'
import { renderAutoView } from '@vt/graph-tools/node'

export interface GraphStructureParams {
    readonly folderPath: string
    readonly withSummaries?: boolean
}

export async function graphStructureTool(params: GraphStructureParams): Promise<McpToolResponse> {
    const { output } = renderAutoView(params.folderPath)
    return buildJsonResponse({ ascii: output })
}
