import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    agentClose,
    agentList,
    agentOutput,
    agentSend,
    agentSpawn,
    agentWait,
} from './commands/runtime/agent.ts'
import {runDebugCommand} from './commands/runtime/debug.ts'
import {runManualCommand} from './commands/manual.ts'
import {findRepoRoot} from './commands/util/findRepoRoot.ts'
import {runSessionCommand} from './commands/runtime/session.ts'
import {runProjectCommand} from './commands/runtime/project.ts'
import {runViewCommand} from './commands/node/view.ts'
import {getErrorMessage} from './commands/graph/core/util.ts'
import {CliError, error} from './commands/output.ts'
import {argsShape} from './commands/telemetry/argsShape.ts'
import {
    installCliInvocationSink,
    setErrorClass,
    setInvocationContext,
} from './commands/telemetry/recordCliInvocation.ts'
import {CliExitError} from './commands/util/exitCodes.ts'
import {resolveVoicetreeHomePath} from '@vt/paths'

type GlobalOptions = {
    terminalId: string | undefined
    commandArgs: string[]
}

const HELP_TEXT: string = `Usage: vt [--terminal ID] [--json] <command> [args]

Commands:
  agent     Manage coding agents
  graph     Graph operations (view, create, group, mv, rename, lint, ...)
  serve     Start headless daemon (graph-db + vt-daemon) for a project
  search    Search nodes by query
  project     Manage project state
  session   Manage sessions
  view      Folder visibility views
  debug     Run debug subcommands
  manual    Print the canonical CLI manual (or one tool section)
  help      Show this help

Global flags:
  --terminal, -t  Caller terminal ID (default: $VOICETREE_TERMINAL_ID)
  --json          Force JSON output

Run "vt <command> --help" for subcommand details.`

const AGENT_HELP: string = `Usage: vt agent <subcommand> [args]

Subcommands:
  spawn     Spawn an agent from an existing node or a new task
  list      List running agents
  wait      Start background monitoring for one or more agents
  close     Close an agent terminal
  send      Send a message to an agent terminal
  output    Read buffered agent output`

const GRAPH_HELP: string = `Usage: vt graph <subcommand> [args]

Subcommands:
  live        Live graph operations (view, state dump, apply, CRUD, focus, ...)
  structure   Render graph via daemon (or local fallback) with progressive-disclosure collapse
  create      Create progress nodes in the graph
  group       Group files into a new folder and update all references
  lint        Lint graph for complexity violations and warnings
  complexity  Score graph cognitive complexity (branching, treewidth, crossings, coupling, cycles)
  rename      Rename a file and update all references
  mv          Move a file or folder and update all references
  index       Build a local semantic search index for a project
  search      Search a local semantic search index for a project
  unseen      Get unseen nodes near your context`

function extractGlobalOptions(argv: string[]): GlobalOptions {
    const commandArgs: string[] = []
    let terminalId: string | undefined = process.env.VOICETREE_TERMINAL_ID
    let commandStarted: boolean = false

    for (let index: number = 0; index < argv.length; index += 1) {
        const current: string = argv[index]

        if (current === '--json') {
            continue
        }

        if (!commandStarted && (current === '--terminal' || current === '-t')) {
            const rawTerminalId: string | undefined = argv[index + 1]
            if (!rawTerminalId) {
                error(`${current} requires a value`)
            }

            terminalId = rawTerminalId
            index += 1
            continue
        }

        if (!commandStarted && current.startsWith('--terminal=')) {
            terminalId = current.slice('--terminal='.length)
            continue
        }

        commandStarted = true
        commandArgs.push(current)
    }

    return {terminalId, commandArgs}
}

function printHelp(): void {
    console.log(HELP_TEXT)
}

async function dispatchAgentCommand(
    terminalId: string | undefined,
    subcommand: string | undefined,
    args: string[]
): Promise<void> {
    switch (subcommand) {
        case 'spawn':
            await agentSpawn(terminalId, args)
            return
        case 'list':
            await agentList(terminalId, args)
            return
        case 'wait':
            await agentWait(terminalId, args)
            return
        case 'close':
            await agentClose(terminalId, args)
            return
        case 'send':
            await agentSend(terminalId, args)
            return
        case 'output':
            await agentOutput(terminalId, args)
            return
        case 'metrics':
            error(
                'agent metrics is not a CLI subcommand. The metrics surface is daemon HTTP-only: ' +
                    'POST the JSON-RPC methods `metrics.getSessions` (read per-session token/cost) or ' +
                    '`metrics.appendSession` (upsert one session) to the daemon `/rpc` endpoint. ' +
                    'No `vt agent metrics` CLI wrapper is wired.',
            )
            return
        case '--help':
        case 'help':
        case undefined:
            console.log(AGENT_HELP)
            return
        default:
            error(`Unknown agent subcommand: ${subcommand}`)
    }
}

async function dispatchGraphCommand(
    terminalId: string | undefined,
    subcommand: string | undefined,
    args: string[]
): Promise<void> {
    switch (subcommand) {
        case 'create': {
            const {graphCreate} = await import('./commands/graph/core/graph.ts')
            await graphCreate(terminalId, args)
            return
        }
        case 'index': {
            const {graphIndex} = await import('./commands/graph/core/graph.ts')
            await graphIndex(terminalId, args)
            return
        }
        case 'search': {
            const {graphSearch} = await import('./commands/graph/core/graph.ts')
            await graphSearch(terminalId, args)
            return
        }
        case 'unseen': {
            const {graphUnseen} = await import('./commands/graph/core/graph.ts')
            await graphUnseen(terminalId, args)
            return
        }
        case 'live': {
            const {graphLive} = await import('./commands/graph/core/graph.ts')
            await graphLive(terminalId, args)
            return
        }
        case 'structure': {
            const {graphStructure} = await import('./commands/graph/core/graph.ts')
            await graphStructure(terminalId, args)
            return
        }
        case 'lint': {
            const {graphLintCommand} = await import('./commands/graph/core/graph.ts')
            await graphLintCommand(terminalId, args)
            return
        }
        case 'complexity': {
            const {graphComplexity} = await import('./commands/graph/core/graph.ts')
            await graphComplexity(terminalId, args)
            return
        }
        case 'rename': {
            const {graphRename} = await import('./commands/node/rename.ts')
            await graphRename(terminalId, args)
            return
        }
        case 'mv': {
            const {graphMove} = await import('./commands/node/move.ts')
            await graphMove(terminalId, args)
            return
        }
        case 'group': {
            const {graphGroup} = await import('./commands/node/group.ts')
            await graphGroup(terminalId, args)
            return
        }
        case '--help':
        case 'help':
        case undefined:
            console.log(GRAPH_HELP)
            return
        default:
            error(`Unknown graph subcommand: ${subcommand}`)
    }
}

async function dispatchSearchCommand(
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const {searchCommand} = await import('./commands/node/search.ts')
    await searchCommand(terminalId, args)
}

function readVtVersion(): string {
    try {
        const pkgPath: string = path.join(findRepoRoot(import.meta.url), 'webapp', 'package.json')
        const parsed: Record<string, unknown> = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (typeof parsed.version === 'string') return parsed.version
        if (typeof parsed.dmeversion === 'string') return parsed.dmeversion
        return 'unknown'
    } catch {
        return 'unknown'
    }
}

const KNOWN_AGENT_SUBS: ReadonlySet<string> = new Set([
    'spawn', 'list', 'wait', 'close', 'send', 'output',
])
const KNOWN_GRAPH_SUBS: ReadonlySet<string> = new Set([
    'create', 'index', 'search', 'unseen', 'live', 'structure', 'lint', 'complexity', 'rename', 'mv', 'group',
])
const KNOWN_TOP_LEVEL: ReadonlySet<string> = new Set([
    'project', 'session', 'view', 'search', 'debug', 'serve', 'webapp', 'manual',
])

function computeVerb(commandArgs: readonly string[]): {verb: string; verbTokensInArgv: number} {
    if (commandArgs.length === 0) return {verb: '(none)', verbTokensInArgv: 0}
    const first: string = commandArgs[0]
    if (first === '--help' || first === '-h') return {verb: 'help', verbTokensInArgv: 0}
    if (first === 'help') return {verb: 'help', verbTokensInArgv: 1}
    const second: string | undefined = commandArgs[1]
    if (first === 'agent') {
        if (second !== undefined && KNOWN_AGENT_SUBS.has(second)) {
            return {verb: `agent ${second}`, verbTokensInArgv: 2}
        }
        return {verb: 'agent', verbTokensInArgv: 1}
    }
    if (first === 'graph') {
        if (second !== undefined && KNOWN_GRAPH_SUBS.has(second)) {
            return {verb: `graph ${second}`, verbTokensInArgv: 2}
        }
        return {verb: 'graph', verbTokensInArgv: 1}
    }
    if (KNOWN_TOP_LEVEL.has(first)) return {verb: first, verbTokensInArgv: 1}
    return {verb: '(unknown)', verbTokensInArgv: 0}
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    // Telemetry must be wired before anything that could call process.exit so
    // the on-exit handler is registered and captures the record. We seed
    // verb="(unknown)" + raw argv shape immediately; the dispatcher refines it.
    const startMs: number = Number(process.hrtime.bigint() / 1_000_000n)
    const telemetryFilePath: string = process.env.VOICETREE_TELEMETRY_PATH
        ?? path.join(resolveVoicetreeHomePath(), 'cli-telemetry.jsonl')
    installCliInvocationSink({
        filePath: telemetryFilePath,
        vtVersion: readVtVersion(),
        startMs,
    })
    setInvocationContext({
        verb: '(unknown)',
        argsShape: argsShape({verb: '(unknown)', verbTokensInArgv: 0, argv}),
    })

    const {terminalId, commandArgs}: GlobalOptions = extractGlobalOptions(argv)

    const verbInfo: {verb: string; verbTokensInArgv: number} = computeVerb(commandArgs)
    setInvocationContext({
        verb: verbInfo.verb,
        argsShape: argsShape({
            verb: verbInfo.verb,
            verbTokensInArgv: verbInfo.verbTokensInArgv,
            argv,
        }),
    })

    if (commandArgs.length === 0) {
        printHelp()
        return
    }

    if (commandArgs[0] === '--help' || commandArgs[0] === '-h') {
        printHelp()
        return
    }

    const [command, subcommand, ...rest]: string[] = commandArgs

    switch (command) {
        case 'help':
            printHelp()
            return
        case 'agent':
            await dispatchAgentCommand(terminalId, subcommand, rest)
            return
        case 'graph':
            await dispatchGraphCommand(terminalId, subcommand, rest)
            return
        case 'project':
            await runProjectCommand(commandArgs.slice(1))
            return
        case 'session':
            await runSessionCommand(commandArgs.slice(1))
            return
        case 'view':
            await runViewCommand(commandArgs.slice(1))
            return
        case 'search':
            await dispatchSearchCommand(terminalId, commandArgs.slice(1))
            return
        case 'debug':
            await runDebugCommand(commandArgs.slice(1))
            return
        case 'manual':
            runManualCommand(commandArgs.slice(1))
            return
        case 'serve':
            {
                const module: {runServeCommand: (argv: string[]) => Promise<void>} =
                    await import('./commands/runtime/serve.ts')
                await module.runServeCommand(commandArgs.slice(1))
            }
            return
        case 'webapp':
            {
                const module: {runWebappCommand: (argv: string[]) => Promise<void>} =
                    await import('./commands/runtime/webapp.ts')
                await module.runWebappCommand(commandArgs.slice(1))
            }
            return
        default:
            error(`Unknown command: ${command}`)
    }
}

function isDirectExecution(): boolean {
    const invokedPath: string | undefined = process.argv[1]
    if (invokedPath === undefined) return false
    // argv[1] may be a symlink (e.g. node_modules/@voicetree/cli is a workspace
    // symlink); import.meta.url is always the real path, so resolve argv[1]
    // before comparing or the guard silently skips main().
    const invokedRealPath: string = fs.realpathSync(invokedPath)
    return invokedRealPath === fileURLToPath(import.meta.url)
}

function writeDebugStack(err: unknown): void {
    if (process.env.VT_DEBUG !== '1') return
    if (!(err instanceof Error) || typeof err.stack !== 'string' || err.stack.length === 0) return
    process.stderr.write(err.stack.endsWith('\n') ? err.stack : `${err.stack}\n`)
}

if (isDirectExecution()) {
    void main().catch((cause: unknown) => {
        if (cause instanceof CliExitError) {
            setErrorClass(cause.errorClass)
            process.stderr.write(`error: ${cause.message}\n`)
            writeDebugStack(cause.cause)
            process.exit(cause.exitCode)
        }
        const errorClass: string = cause instanceof CliError
            ? 'CliError'
            : cause instanceof Error ? cause.name : 'UnknownError'
        setErrorClass(errorClass)
        console.error(`error: ${getErrorMessage(cause)}`)
        process.exit(1)
    })
}
