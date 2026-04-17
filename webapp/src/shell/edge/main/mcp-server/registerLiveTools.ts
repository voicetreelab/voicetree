/**
 * BF-161/BF-162 · live MCP tool registrations extracted from mcp-server.ts
 * to keep that file under its 500-line cap.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { dispatchLiveCommandTool } from './dispatchLiveCommandTool'
import { getLiveStateTool } from './getLiveStateTool'

const DISPATCH_DESCRIPTION: string = [
    'SerializedCommand payload. Shape per command.type:',
    '- Collapse/Expand: {type, folder}',
    '- Select: {type, ids[], additive?}',
    '- Deselect: {type, ids[]}',
    '- Move: {type, id, to:{x,y}}',
    '- LoadRoot/UnloadRoot: {type, root}',
    '- AddEdge: {type, source, edge:{targetId,label}}',
    '- RemoveEdge: {type, source, targetId}',
    '- RemoveNode: {type, id}',
    '- AddNode: {type, node} (full SerializedGraphNode)',
].join('\n')

export function registerLiveTools(server: McpServer): void {
    server.registerTool(
        'vt_get_live_state',
        {
            title: 'Get Live VoiceTree State',
            description: 'Return a SerializedState snapshot of the running app (graph, collapseSet, selection, revision). Matches the @vt/graph-state SerializedState schema so the CLI can hydrateState the output.',
            inputSchema: {},
        },
        async () => getLiveStateTool(),
    )

    server.registerTool(
        'vt_dispatch_live_command',
        {
            title: 'Dispatch Live VoiceTree Command',
            description: 'Apply a SerializedCommand to the running app. Returns {delta, revision}. For L1, only Collapse/Expand/Select/Deselect are wired — other commands return {error:"not-yet-wired"}.',
            inputSchema: {
                command: z.record(z.unknown()).describe(DISPATCH_DESCRIPTION),
            },
        },
        async (args: { command: Record<string, unknown> }) =>
            dispatchLiveCommandTool({ command: args.command as never }),
    )
}
