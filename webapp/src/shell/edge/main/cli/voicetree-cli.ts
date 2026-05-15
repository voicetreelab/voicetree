import {pathToFileURL} from 'node:url'
import {
    agentClose,
    agentList,
    agentOutput,
    agentSend,
    agentSpawn,
    agentWait,
} from './commands/runtime/agent.ts'
import {runDebugCommand} from './commands/runtime/debug.ts'
import {runSessionCommand} from './commands/runtime/session.ts'
import {runVaultCommand} from './commands/runtime/vault.ts'
import {runViewCommand} from './commands/node/view.ts'
import {error} from './output.ts'

type GlobalOptions = {
    port: number
    terminalId: string | undefined
    commandArgs: string[]
}

type CommandHandler = (port: number, terminalId: string | undefined, args: string[]) => Promise<void>

const HELP_TEXT: string = `Usage: vt [--port PORT] [--terminal ID] [--json] <command> [args]

Commands:
  agent     Manage coding agents
  graph     Graph operations (view, create, group, mv, rename, lint, ...)
  serve     Start headless daemon (graph-db + MCP server) for a vault
  search    Search nodes by query
  vault     Manage vault state
  session   Manage sessions
  view      Folder visibility views
  debug     Run debug subcommands
  help      Show this help

Global flags:
  --port, -p      MCP server port (default: $VOICETREE_MCP_PORT or 3002)
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
  view        (deprecated — use structure) Alias for structure
  lint        Lint graph for complexity violations and warnings
  rename      Rename a file and update all references
  mv          Move a file or folder and update all references
  index       Build a local semantic search index for a vault
  search      Search a local semantic search index for a vault
  unseen      Get unseen nodes near your context`

function getErrorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

function parsePort(rawPort: string): number {
    const parsedPort: number = Number(rawPort)
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
        error(`Invalid port: ${rawPort}`)
    }

    return parsedPort
}

function extractGlobalOptions(argv: string[]): GlobalOptions {
    const commandArgs: string[] = []
    let port: number = parsePort(process.env.VOICETREE_MCP_PORT ?? '3002')
    let terminalId: string | undefined = process.env.VOICETREE_TERMINAL_ID
    let commandStarted: boolean = false

    for (let index: number = 0; index < argv.length; index += 1) {
        const current: string = argv[index]

        if (current === '--json') {
            continue
        }

        if (!commandStarted && (current === '--port' || current === '-p')) {
            const rawPort: string | undefined = argv[index + 1]
            if (!rawPort) {
                error(`${current} requires a value`)
            }

            port = parsePort(rawPort)
            index += 1
            continue
        }

        if (!commandStarted && current.startsWith('--port=')) {
            port = parsePort(current.slice('--port='.length))
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

    return {port, terminalId, commandArgs}
}

function printHelp(): void {
    console.log(HELP_TEXT)
}

async function loadDeferredHandler(
    moduleSpecifier: string,
    exportName: string,
    unavailableMessage: string
): Promise<CommandHandler> {
    try {
        const module: Record<string, unknown> = await import(moduleSpecifier)
        const handler: unknown = module[exportName]
        if (typeof handler !== 'function') {
            throw new Error(`Missing export \`${exportName}\` in ${moduleSpecifier}`)
        }

        return handler as CommandHandler
    } catch (cause) {
        const message: string = getErrorMessage(cause)
        if (message.includes('Cannot find module') || message.includes('Failed to resolve module')) {
            error(unavailableMessage)
        }

        throw cause
    }
}

async function dispatchAgentCommand(
    port: number,
    terminalId: string | undefined,
    subcommand: string | undefined,
    args: string[]
): Promise<void> {
    switch (subcommand) {
        case 'spawn':
            await agentSpawn(port, terminalId, args)
            return
        case 'list':
            await agentList(port, terminalId, args)
            return
        case 'wait':
            await agentWait(port, terminalId, args)
            return
        case 'close':
            await agentClose(port, terminalId, args)
            return
        case 'send':
            await agentSend(port, terminalId, args)
            return
        case 'output':
            await agentOutput(port, terminalId, args)
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
    port: number,
    terminalId: string | undefined,
    subcommand: string | undefined,
    args: string[]
): Promise<void> {
    switch (subcommand) {
        case 'create': {
            const graphCreate: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphCreate',
                'Graph commands are not available in this build yet'
            )
            await graphCreate(port, terminalId, args)
            return
        }
        case 'index': {
            const graphIndex: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphIndex',
                'Graph commands are not available in this build yet'
            )
            await graphIndex(port, terminalId, args)
            return
        }
        case 'search': {
            const graphSearch: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphSearch',
                'Graph commands are not available in this build yet'
            )
            await graphSearch(port, terminalId, args)
            return
        }
        case 'unseen': {
            const graphUnseen: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphUnseen',
                'Graph commands are not available in this build yet'
            )
            await graphUnseen(port, terminalId, args)
            return
        }
        case 'live': {
            const graphLive: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphLive',
                'Graph live commands are not available in this build yet'
            )
            await graphLive(port, terminalId, args)
            return
        }
        case 'structure': {
            const graphStructure: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphStructure',
                'Graph commands are not available in this build yet'
            )
            await graphStructure(port, terminalId, args)
            return
        }
        case 'view': {
            const graphView: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphView',
                'Graph commands are not available in this build yet'
            )
            await graphView(port, terminalId, args)
            return
        }
        case 'lint': {
            const graphLintCommand: CommandHandler = await loadDeferredHandler(
                './commands/graph/core/graph',
                'graphLintCommand',
                'Graph commands are not available in this build yet'
            )
            await graphLintCommand(port, terminalId, args)
            return
        }
        case 'rename': {
            const graphRename: CommandHandler = await loadDeferredHandler(
                './commands/node/rename.ts',
                'graphRename',
                'Rename command is not available in this build yet'
            )
            await graphRename(port, terminalId, args)
            return
        }
        case 'mv': {
            const graphMove: CommandHandler = await loadDeferredHandler(
                './commands/node/move.ts',
                'graphMove',
                'Move command is not available in this build yet'
            )
            await graphMove(port, terminalId, args)
            return
        }
        case 'group': {
            const graphGroup: CommandHandler = await loadDeferredHandler(
                './commands/node/group.ts',
                'graphGroup',
                'Group command is not available in this build yet'
            )
            await graphGroup(port, terminalId, args)
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
    port: number,
    terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const searchHandler: CommandHandler = await loadDeferredHandler(
        './commands/node/search.ts',
        'searchCommand',
        'Search commands are not available in this build yet'
    )
    await searchHandler(port, terminalId, args)
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    const {port, terminalId, commandArgs}: GlobalOptions = extractGlobalOptions(argv)

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
            await dispatchAgentCommand(port, terminalId, subcommand, rest)
            return
        case 'graph':
            await dispatchGraphCommand(port, terminalId, subcommand, rest)
            return
        case 'vault':
            await runVaultCommand(commandArgs.slice(1))
            return
        case 'session':
            await runSessionCommand(commandArgs.slice(1))
            return
        case 'view':
            await runViewCommand(commandArgs.slice(1))
            return
        case 'search':
            await dispatchSearchCommand(port, terminalId, commandArgs.slice(1))
            return
        case 'debug':
            await runDebugCommand(commandArgs.slice(1))
            return
        case 'serve':
            {
                const module: {runServeCommand: (argv: string[]) => Promise<void>} =
                    await import('./commands/runtime/serve.ts')
                await module.runServeCommand(commandArgs.slice(1))
            }
            return
        default:
            error(`Unknown command: ${command}`)
    }
}

function isDirectExecution(): boolean {
    const invokedPath: string | undefined = process.argv[1]
    return invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href
}

if (isDirectExecution()) {
    void main().catch((cause: unknown) => {
        error(getErrorMessage(cause))
    })
}
