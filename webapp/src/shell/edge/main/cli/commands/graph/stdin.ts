import {error} from '../../output.ts'
import type {GraphCreateNode, GraphCreatePayload} from './types.ts'
import {getErrorMessage, isRecord} from './util.ts'

export async function readCreateGraphPayloadFromStdin(terminalId: string | undefined): Promise<{
    callerTerminalId: string
    parentNodeId?: string
    nodes: GraphCreateNode[]
    override_with_rationale?: unknown
}> {
    const fsModule: typeof import('fs') = await import('fs')
    let rawPayload: string
    try {
        rawPayload = fsModule.readFileSync(0, 'utf8').trim()
    } catch (readError: unknown) {
        error(`Failed to read graph create payload from stdin: ${getErrorMessage(readError)}`)
    }

    if (!rawPayload) {
        error('Stdin was empty. Provide create_graph JSON payload.')
    }

    let payload: unknown
    try {
        payload = JSON.parse(rawPayload)
    } catch (parseError: unknown) {
        error(`Stdin is not valid JSON: ${getErrorMessage(parseError)}`)
    }

    if (!isRecord(payload)) {
        error('Stdin JSON payload must be an object')
    }

    const typedPayload: GraphCreatePayload = payload
    const callerTerminalId: string | undefined =
        typeof typedPayload.callerTerminalId === 'string' ? typedPayload.callerTerminalId : terminalId

    if (!callerTerminalId) {
        error('graph create via stdin requires callerTerminalId in payload or --terminal')
    }

    if (
        typedPayload.parentNodeId !== undefined &&
        typeof typedPayload.parentNodeId !== 'string'
    ) {
        error('parentNodeId must be a string')
    }

    const parentNodeId: string | undefined = typedPayload.parentNodeId

    if (!Array.isArray(typedPayload.nodes)) {
        error('graph create via stdin requires nodes: GraphCreateNode[]')
    }

    const nodes: GraphCreateNode[] = typedPayload.nodes.map((node: unknown, index: number) => {
        if (!isRecord(node)) {
            error(`Stdin node at index ${index} must be a JSON object`)
        }

        return node as GraphCreateNode
    })

    if (parentNodeId !== undefined && parentNodeId.length === 0) {
        error('parentNodeId must be a non-empty string')
    }

    return {
        callerTerminalId,
        ...(parentNodeId !== undefined ? {parentNodeId} : {}),
        nodes,
        ...(typedPayload.override_with_rationale !== undefined
            ? {override_with_rationale: typedPayload.override_with_rationale}
            : {}),
    }
}
