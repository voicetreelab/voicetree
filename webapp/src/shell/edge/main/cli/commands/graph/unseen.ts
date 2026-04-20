import {callMcpTool} from '../../mcp-client.ts'
import {error, output} from '../../output.ts'
import {getErrorMessage, getRequiredValue, requireTerminalId} from './args.ts'
import type {GraphUnseenNode, GraphUnseenSuccess, ToolFailure} from './types.ts'

export async function graphUnseen(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)

    let searchFromNode: string | undefined

    for (let index: number = 0; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--from') {
            searchFromNode = getRequiredValue(args, index + 1, '--from')
            index += 1
            continue
        }

        error(`Unknown argument: ${arg}`)
    }

    try {
        const response: unknown = await callMcpTool(port, 'get_unseen_nodes_nearby', {
            callerTerminalId,
            ...(searchFromNode ? {search_from_node: searchFromNode} : {}),
        })
        const result: GraphUnseenSuccess | ToolFailure = response as GraphUnseenSuccess | ToolFailure
        if (!result.success) {
            error(result.error)
        }

        output(result, (data: unknown): string => {
            const successData: GraphUnseenSuccess = data as GraphUnseenSuccess
            if (successData.unseenNodes.length === 0) {
                return 'No unseen nodes found.'
            }

            return successData.unseenNodes.map((node: GraphUnseenNode) => node.title).join('\n')
        })
    } catch (toolError: unknown) {
        error(`get_unseen_nodes_nearby failed: ${getErrorMessage(toolError)}`)
    }
}
