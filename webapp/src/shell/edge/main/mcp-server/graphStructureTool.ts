import { buildJsonResponse } from './types'
import type { McpToolResponse } from './types'
import { getGraphStructure } from '@vt/graph-tools'

export interface GraphStructureParams {
    readonly folderPath: string
}

export async function graphStructureTool(params: GraphStructureParams): Promise<McpToolResponse> {
    return buildJsonResponse(getGraphStructure(params.folderPath))
}
