/**
 * Static specifications for every `vt agent <verb>` subcommand. Each spec is
 * the single source of truth for:
 *
 *   - which CLI flags the parser accepts (consumed by `parseArgs` in agent.ts),
 *   - which JSON RPC parameter each flag maps to (consumed by `formatHelp`),
 *   - the human-readable usage and per-flag descriptions printed by
 *     `vt agent <verb> --help`.
 *
 * Storing all three on the same `FlagSpec` value is what prevents the parser
 * from drifting from the help text: the help text is generated from the
 * parser's flag list, not maintained in parallel.
 *
 * Most CLI flags are NOT pure kebab-case transforms of their RPC name (e.g.
 * `--name` ↔ `agentName`, `--depth` ↔ `depthBudget`, `--chars` ↔ `nChars`).
 * The mapping is therefore explicit per flag rather than derived from the
 * flag name at runtime.
 */

export type FlagSpec = {
    readonly flag: string
    readonly kind: 'value' | 'bool'
    readonly rpcParam: string
    readonly description: string
}

export type SubcommandSpec = {
    readonly verb: string
    readonly rpcTool: string
    readonly usageTail: string
    readonly summary: string
    readonly flags: readonly FlagSpec[]
}

export const AGENT_SPAWN_SPEC: SubcommandSpec = {
    verb: 'vt agent spawn',
    rpcTool: 'spawn_agent',
    usageTail: '(--node ID | --task TEXT --parent ID) [flags]',
    summary: 'Spawn an agent in the Voicetree graph from an existing node or a new task.',
    flags: [
        {flag: '--node', kind: 'value', rpcParam: 'nodeId',
            description: 'Target node ID to attach the spawned agent (use this OR --task+--parent)'},
        {flag: '--task', kind: 'value', rpcParam: 'task',
            description: 'Task description for creating a new task node. First line becomes the title.'},
        {flag: '--parent', kind: 'value', rpcParam: 'parentNodeId',
            description: 'Parent node ID under which to create the new task node (required with --task)'},
        {flag: '--name', kind: 'value', rpcParam: 'agentName',
            description: 'Agent name from settings.agents (e.g. "Claude Sonnet"). Defaults to caller\'s agent.'},
        {flag: '--depth', kind: 'value', rpcParam: 'depthBudget',
            description: 'Explicit depth budget for the child. Auto-decrements from caller when omitted.'},
        {flag: '--spawn-dir', kind: 'value', rpcParam: 'spawnDirectory',
            description: 'Absolute path to spawn the agent in. Defaults to parent terminal\'s directory.'},
        {flag: '--prompt-template', kind: 'value', rpcParam: 'promptTemplate',
            description: 'INJECT_ENV_VARS key to use as AGENT_PROMPT instead of the default.'},
        {flag: '--headless', kind: 'bool', rpcParam: 'headless',
            description: 'Run agent as background process with no PTY/terminal UI.'},
        {flag: '--replace-self', kind: 'bool', rpcParam: 'replaceSelf',
            description: 'Successor inherits caller\'s terminal ID; caller is killed atomically.'},
    ],
}

export const AGENT_LIST_SPEC: SubcommandSpec = {
    verb: 'vt agent list',
    rpcTool: 'list_agents',
    usageTail: '',
    summary: 'List running agent terminals with status and newly created nodes.',
    flags: [],
}

export const AGENT_WAIT_SPEC: SubcommandSpec = {
    verb: 'vt agent wait',
    rpcTool: 'wait_for_agents',
    usageTail: '<terminalId>... [flags]',
    summary: 'Start a background monitor that notifies your terminal when listed agents finish.',
    flags: [
        {flag: '--poll-interval', kind: 'value', rpcParam: 'pollIntervalMs',
            description: 'Poll interval in milliseconds (default 5000).'},
    ],
}

export const AGENT_CLOSE_SPEC: SubcommandSpec = {
    verb: 'vt agent close',
    rpcTool: 'close_agent',
    usageTail: '<terminalId> [flags]',
    summary: 'Close an agent terminal. Use --force with a reason to close a still-running agent.',
    flags: [
        {flag: '--force', kind: 'value', rpcParam: 'forceWithReason',
            description: 'Required to close a running (non-idle) agent. Provide a reason string.'},
    ],
}

export const AGENT_RESUME_SPEC: SubcommandSpec = {
    verb: 'vt agent resume',
    rpcTool: 'resumePersistedAgentSession',
    usageTail: '<terminalId>',
    summary: 'Resume a closed/exited agent under its original terminalId.',
    flags: [],
}

export const AGENT_FORK_SPEC: SubcommandSpec = {
    verb: 'vt agent fork',
    rpcTool: 'forkAgentSession',
    usageTail: '[terminalId]',
    summary: 'Fork a live (or exited) agent into a new branched terminal. Defaults to the caller.',
    flags: [],
}

export const AGENT_SEND_SPEC: SubcommandSpec = {
    verb: 'vt agent send',
    rpcTool: 'send_message',
    usageTail: '<terminalId> <message>...',
    summary: 'Send a message into an agent terminal (carriage return appended).',
    flags: [],
}

export const AGENT_OUTPUT_SPEC: SubcommandSpec = {
    verb: 'vt agent output',
    rpcTool: 'read_terminal_output',
    usageTail: '<terminalId> [flags]',
    summary: 'Read the last N characters of buffered output from an agent terminal.',
    flags: [
        {flag: '--chars', kind: 'value', rpcParam: 'nChars',
            description: 'Number of characters to return (default 10000).'},
    ],
}

/**
 * The `--terminal` / `-t` global flag is a structural exception: it is
 * collected by the top-level CLI dispatcher (in `voicetree-cli.ts`) and
 * sent on every RPC as `callerTerminalId`. It is documented in every
 * subcommand's `--help` so agents reading one help block see the full
 * picture without cross-referencing.
 */
const GLOBAL_CALLER_TERMINAL_NOTE: string =
    '  --terminal / -t            (RPC: callerTerminalId)  Caller terminal ID; '
    + 'defaults to $VOICETREE_TERMINAL_ID. Global flag — set before the verb.'

function formatFlagLine(spec: FlagSpec): string {
    const flagAndKind: string = spec.kind === 'value' ? `${spec.flag} VALUE` : spec.flag
    const left: string = `  ${flagAndKind}`.padEnd(28)
    const rpc: string = `(RPC: ${spec.rpcParam})`.padEnd(24)
    return `${left} ${rpc} ${spec.description}`
}

export function formatHelp(spec: SubcommandSpec): string {
    const usage: string = spec.usageTail.length > 0
        ? `Usage: ${spec.verb} ${spec.usageTail}`
        : `Usage: ${spec.verb}`
    const lines: string[] = [usage, '', spec.summary, '']
    lines.push(`RPC tool: ${spec.rpcTool}`)
    lines.push('')
    lines.push('Flags:')
    lines.push(GLOBAL_CALLER_TERMINAL_NOTE)
    for (const flag of spec.flags) {
        lines.push(formatFlagLine(flag))
    }
    lines.push('')
    lines.push(
        'CLI flag names map to JSON RPC parameter names via the `(RPC: …)` column. '
        + 'See `vt manual ' + spec.verb.replace(/^vt /, '') + '` for the full schema.',
    )
    return lines.join('\n')
}

export function isHelpRequest(args: readonly string[]): boolean {
    return args.length > 0 && (args[0] === '--help' || args[0] === '-h')
}

export function valueFlagNames(spec: SubcommandSpec): readonly string[] {
    return spec.flags
        .filter((flag: FlagSpec): boolean => flag.kind === 'value')
        .map((flag: FlagSpec): string => flag.flag)
}

export function booleanFlagNames(spec: SubcommandSpec): readonly string[] {
    return spec.flags
        .filter((flag: FlagSpec): boolean => flag.kind === 'bool')
        .map((flag: FlagSpec): string => flag.flag)
}
