import {error} from '../cliDeps'
import {parseOverrideEntry} from '../core/overrideSpec'
import type {GraphCreateNode, GraphCreatePayload, OverrideSpec} from '../core/types'
import {getErrorMessage, isRecord} from '../core/util'

export async function readCreateGraphPayloadFromStdin(terminalId: string | undefined): Promise<{
    callerTerminalId: string
    parentNodeId?: string
    outputPath?: string
    nodes: GraphCreateNode[]
    overrides: readonly OverrideSpec[]
    agentStatus?: string
    statusPhrase?: string
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

    if (
        typedPayload.outputPath !== undefined &&
        typeof typedPayload.outputPath !== 'string'
    ) {
        error('outputPath must be a string')
    }

    const outputPath: string | undefined = typedPayload.outputPath

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
    if (outputPath !== undefined && outputPath.trim().length === 0) {
        error('outputPath must be a non-empty string')
    }

    const overrides: readonly OverrideSpec[] = parseStdinOverrides(typedPayload.override_with_rationale)

    if (typedPayload.agentStatus !== undefined && typeof typedPayload.agentStatus !== 'string') {
        error('agentStatus must be a string')
    }
    if (typedPayload.statusPhrase !== undefined && typeof typedPayload.statusPhrase !== 'string') {
        error('statusPhrase must be a string')
    }
    const agentStatus: string | undefined = typedPayload.agentStatus as string | undefined
    const statusPhrase: string | undefined = typedPayload.statusPhrase as string | undefined

    return {
        callerTerminalId,
        ...(parentNodeId !== undefined ? {parentNodeId} : {}),
        ...(outputPath !== undefined ? {outputPath} : {}),
        nodes,
        overrides,
        ...(agentStatus !== undefined ? {agentStatus} : {}),
        ...(statusPhrase !== undefined ? {statusPhrase} : {}),
    }
}

function parseStdinOverrides(raw: unknown): readonly OverrideSpec[] {
    if (raw === undefined) return []
    if (!Array.isArray(raw)) {
        error('Stdin override_with_rationale must be an array of {ruleId, rationale} objects')
    }
    return raw.map((entry: unknown, index: number): OverrideSpec =>
        parseOverrideEntry(entry, `Stdin override_with_rationale[${index}]`),
    )
}
