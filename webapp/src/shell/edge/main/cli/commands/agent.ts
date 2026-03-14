import {callMcpTool} from '../mcp-client.ts'
import {error, output} from '../output.ts'

type JsonRecord = Record<string, unknown>

type ParsedArgs = {
    positionals: string[]
    values: Map<string, string>
    booleans: Set<string>
}

function asRecord(value: unknown): JsonRecord | undefined {
    return typeof value === 'object' && value !== null
        ? value as JsonRecord
        : undefined
}

function parseArgs(
    args: string[],
    options: {valueFlags?: readonly string[]; booleanFlags?: readonly string[]}
): ParsedArgs {
    const valueFlags: Set<string> = new Set(options.valueFlags ?? [])
    const booleanFlags: Set<string> = new Set(options.booleanFlags ?? [])
    const positionals: string[] = []
    const values: Map<string, string> = new Map()
    const booleans: Set<string> = new Set()

    for (let index: number = 0; index < args.length; index += 1) {
        const current: string = args[index]

        if (current === '--') {
            positionals.push(...args.slice(index + 1))
            break
        }

        if (!current.startsWith('--')) {
            positionals.push(current)
            continue
        }

        const [flag, inlineValue] = current.split('=', 2)

        if (valueFlags.has(flag)) {
            const value: string | undefined = inlineValue ?? args[index + 1]
            if (value === undefined || value.startsWith('--')) {
                error(`${flag} requires a value`)
            }

            values.set(flag, value)
            if (inlineValue === undefined) {
                index += 1
            }
            continue
        }

        if (booleanFlags.has(flag)) {
            if (inlineValue !== undefined) {
                error(`${flag} does not accept a value`)
            }

            booleans.add(flag)
            continue
        }

        error(`Unknown flag: ${flag}`)
    }

    return {positionals, values, booleans}
}

function requireTerminalId(terminalId: string | undefined): string {
    if (!terminalId) {
        error('`--terminal` / `-t` is required for this command or set VOICETREE_TERMINAL_ID')
    }

    return terminalId
}

function requireNonEmptyValue(value: string | undefined, message: string): string {
    if (!value || value.trim() === '') {
        error(message)
    }

    return value
}

function parseNumberFlag(flag: string, value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined
    }

    const parsedValue: number = Number(value)
    if (!Number.isFinite(parsedValue)) {
        error(`${flag} must be a number`)
    }

    return parsedValue
}

function getToolError(payload: unknown): string | undefined {
    const record: JsonRecord | undefined = asRecord(payload)
    if (!record) {
        return undefined
    }

    if (record.success === false && typeof record.error === 'string') {
        return record.error
    }

    if (typeof record.error === 'string' && !('success' in record)) {
        return record.error
    }

    return undefined
}

function ensureSuccessfulPayload(payload: unknown): JsonRecord {
    const toolError: string | undefined = getToolError(payload)
    if (toolError) {
        error(toolError)
    }

    const record: JsonRecord | undefined = asRecord(payload)
    if (!record) {
        error('Voicetree MCP server returned an unexpected payload')
    }

    return record
}

function formatKeyValueLines(entries: Array<[string, unknown]>): string {
    return entries
        .filter(([, value]: [string, unknown]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]: [string, unknown]) => `${label}: ${String(value)}`)
        .join('\n')
}

function formatTable(
    rows: Array<Record<string, string>>,
    columns: Array<{key: string; label: string}>
): string {
    const widths: Map<string, number> = new Map(
        columns.map(({key, label}: {key: string; label: string}) => {
            const columnWidth: number = rows.reduce((maxWidth: number, row: Record<string, string>) => {
                return Math.max(maxWidth, row[key]?.length ?? 0)
            }, label.length)
            return [key, columnWidth]
        })
    )

    const formatRow: (row: Record<string, string>) => string = (row: Record<string, string>) =>
        columns
            .map(({key}: {key: string; label: string}, index: number) => {
                const padding: number = widths.get(key) ?? 0
                const cell: string = row[key] ?? ''
                return index === columns.length - 1 ? cell : cell.padEnd(padding)
            })
            .join('  ')

    const headerCells: Record<string, string> = Object.fromEntries(
        columns.map(({key, label}: {key: string; label: string}) => [key, label])
    )
    const dividerCells: Record<string, string> = Object.fromEntries(
        columns.map(({key}: {key: string; label: string}) => [key, '-'.repeat(widths.get(key) ?? 0)])
    )

    return [formatRow(headerCells), formatRow(dividerCells), ...rows.map(formatRow)].join('\n')
}

type AgentListItem = {
    terminalId: string
    title: string
    status: string
    isHeadless?: boolean
}

function formatAgentList(payload: JsonRecord): string {
    const agents: AgentListItem[] = Array.isArray(payload.agents)
        ? payload.agents
            .map((agent: unknown) => asRecord(agent))
            .filter((agent: JsonRecord | undefined): agent is JsonRecord => agent !== undefined)
            .map((agent: JsonRecord) => ({
                terminalId: typeof agent.terminalId === 'string' ? agent.terminalId : '',
                title: typeof agent.title === 'string' ? agent.title : '',
                status: typeof agent.status === 'string' ? agent.status : '',
                isHeadless: agent.isHeadless === true,
            }))
        : []

    if (agents.length === 0) {
        const availableAgents: string[] = Array.isArray(payload.availableAgents)
            ? payload.availableAgents.filter((value: unknown): value is string => typeof value === 'string')
            : []
        return availableAgents.length > 0
            ? `No agents.\n\nAvailable agent names: ${availableAgents.join(', ')}`
            : 'No agents.'
    }

    const table: string = formatTable(
        agents.map((agent: AgentListItem) => ({
            status: agent.status,
            terminal: agent.terminalId,
            mode: agent.isHeadless ? 'headless' : 'interactive',
            title: agent.title,
        })),
        [
            {key: 'status', label: 'STATUS'},
            {key: 'terminal', label: 'TERMINAL'},
            {key: 'mode', label: 'MODE'},
            {key: 'title', label: 'TITLE'},
        ]
    )

    const availableAgents: string[] = Array.isArray(payload.availableAgents)
        ? payload.availableAgents.filter((value: unknown): value is string => typeof value === 'string')
        : []

    return availableAgents.length > 0
        ? `${table}\n\nAvailable agent names: ${availableAgents.join(', ')}`
        : table
}

function formatTerminalOutput(payload: JsonRecord): string {
    const terminalOutput: string | undefined = typeof payload.output === 'string' ? payload.output : undefined
    return terminalOutput && terminalOutput.length > 0 ? terminalOutput : '(no output)'
}

function formatStandardResponse(payload: JsonRecord): string {
    const entries: Array<[string, unknown]> = [
        ['Message', payload.message],
        ['Terminal', payload.terminalId],
        ['Node', payload.nodeId],
        ['Task node', payload.taskNodeId],
        ['Context', payload.contextNodeId],
        ['Monitor', payload.monitorId],
        ['Status', payload.status],
        ['Terminals', Array.isArray(payload.terminalIds) ? payload.terminalIds.join(', ') : undefined],
        ['Depth budget', payload.depthBudget],
    ]

    return formatKeyValueLines(entries)
}

export async function agentSpawn(
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)
    const parsedArgs: ParsedArgs = parseArgs(args, {
        valueFlags: ['--node', '--task', '--parent', '--name', '--depth', '--spawn-dir', '--prompt-template'],
        booleanFlags: ['--headless', '--replace-self'],
    })

    const nodeId: string | undefined = parsedArgs.values.get('--node')
    const task: string | undefined = parsedArgs.values.get('--task')
    const parentNodeId: string | undefined = parsedArgs.values.get('--parent')

    if (parsedArgs.positionals.length > 0) {
        error(`Unexpected positional arguments for \`agent spawn\`: ${parsedArgs.positionals.join(' ')}`)
    }

    if (nodeId && task) {
        error('Use either `--node` or `--task`, not both')
    }

    if (!nodeId && !task) {
        error('`agent spawn` requires either `--node ID` or `--task TEXT --parent ID`')
    }

    if (task && !parentNodeId) {
        error('`--parent` is required when using `--task`')
    }

    const payload: JsonRecord = ensureSuccessfulPayload(
        await callMcpTool(port, 'spawn_agent', {
            callerTerminalId,
            ...(nodeId ? {nodeId} : {}),
            ...(task ? {task} : {}),
            ...(parentNodeId ? {parentNodeId} : {}),
            ...(parsedArgs.values.has('--name') ? {agentName: parsedArgs.values.get('--name')} : {}),
            ...(parsedArgs.booleans.has('--headless') ? {headless: true} : {}),
            ...(parsedArgs.values.has('--depth')
                ? {depthBudget: parseNumberFlag('--depth', parsedArgs.values.get('--depth'))}
                : {}),
            ...(parsedArgs.values.has('--spawn-dir')
                ? {spawnDirectory: parsedArgs.values.get('--spawn-dir')}
                : {}),
            ...(parsedArgs.booleans.has('--replace-self') ? {replaceSelf: true} : {}),
            ...(parsedArgs.values.has('--prompt-template')
                ? {promptTemplate: parsedArgs.values.get('--prompt-template')}
                : {}),
        })
    )

    output(payload, formatStandardResponse)
}

export async function agentList(
    port: number,
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    if (args.length > 0) {
        error(`Unexpected arguments for \`agent list\`: ${args.join(' ')}`)
    }

    const payload: JsonRecord = ensureSuccessfulPayload(await callMcpTool(port, 'list_agents', {}))
    output(payload, formatAgentList)
}

export async function agentWait(
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)
    const parsedArgs: ParsedArgs = parseArgs(args, {
        valueFlags: ['--poll-interval'],
    })

    if (parsedArgs.positionals.length === 0) {
        error('`agent wait` requires at least one terminal ID')
    }

    const payload: JsonRecord = ensureSuccessfulPayload(
        await callMcpTool(port, 'wait_for_agents', {
            callerTerminalId,
            terminalIds: parsedArgs.positionals,
            ...(parsedArgs.values.has('--poll-interval')
                ? {pollIntervalMs: parseNumberFlag('--poll-interval', parsedArgs.values.get('--poll-interval'))}
                : {}),
        })
    )

    output(payload, formatStandardResponse)
}

export async function agentClose(
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)
    const parsedArgs: ParsedArgs = parseArgs(args, {
        valueFlags: ['--force'],
    })

    if (parsedArgs.positionals.length !== 1) {
        error('`agent close` requires exactly one target terminal ID')
    }

    const payload: JsonRecord = ensureSuccessfulPayload(
        await callMcpTool(port, 'close_agent', {
            callerTerminalId,
            terminalId: parsedArgs.positionals[0],
            ...(parsedArgs.values.has('--force')
                ? {forceWithReason: requireNonEmptyValue(parsedArgs.values.get('--force'), '`--force` requires a reason')}
                : {}),
        })
    )

    output(payload, formatStandardResponse)
}

export async function agentSend(
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)

    if (args.length < 2) {
        error('`agent send` requires a target terminal ID followed by a message')
    }

    const [targetTerminalId, ...messageParts]: string[] = args
    const message: string = messageParts.join(' ').trim()
    if (message.length === 0) {
        error('`agent send` requires a non-empty message')
    }

    const payload: JsonRecord = ensureSuccessfulPayload(
        await callMcpTool(port, 'send_message', {
            callerTerminalId,
            terminalId: targetTerminalId,
            message,
        })
    )

    output(payload, formatStandardResponse)
}

export async function agentOutput(
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)
    const parsedArgs: ParsedArgs = parseArgs(args, {
        valueFlags: ['--chars'],
    })

    if (parsedArgs.positionals.length !== 1) {
        error('`agent output` requires exactly one target terminal ID')
    }

    const payload: JsonRecord = ensureSuccessfulPayload(
        await callMcpTool(port, 'read_terminal_output', {
            callerTerminalId,
            terminalId: parsedArgs.positionals[0],
            ...(parsedArgs.values.has('--chars')
                ? {nChars: parseNumberFlag('--chars', parsedArgs.values.get('--chars'))}
                : {}),
        })
    )

    output(payload, formatTerminalOutput)
}
