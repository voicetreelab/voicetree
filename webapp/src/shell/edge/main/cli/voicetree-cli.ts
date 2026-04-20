import {pathToFileURL} from 'node:url'
import {
    agentClose,
    agentList,
    agentOutput,
    agentSend,
    agentSpawn,
    agentWait,
} from './commands/agent.ts'
import {runSessionCommand} from './commands/session.ts'
import {runVaultCommand} from './commands/vault.ts'
import {runViewCommand} from './commands/view.ts'
import {error} from './output.ts'

type GlobalOptions = {
    port: number
    terminalId: string | undefined
    commandArgs: string[]
}

type CommandHandler = (port: number, terminalId: string | undefined, args: string[]) => Promise<void>

const HELP_TEXT: string = `Usage:
  voicetree [--port PORT] [--terminal ID] [--json] <command> <subcommand> [args]

Global flags:
  --port, -p      MCP server port (default: $VOICETREE_MCP_PORT or 3002)
  --terminal, -t  Caller terminal ID (default: $VOICETREE_TERMINAL_ID)
  --json          Force JSON output

Commands:
  agent spawn     Spawn an agent from an existing node or a new task
  agent list      List running agents
  agent wait      Start background monitoring for one or more agents
  agent close     Close an agent terminal
  agent send      Send a message to an agent terminal
  agent output    Read buffered agent output
  graph view      Render a folder as tree-cover with progressive-disclosure collapse (default)
  graph create    Create progress nodes in the graph
  graph index     Build a local semantic search index for a vault
  graph search    Search a local semantic search index for a vault
  graph unseen    Get unseen nodes near your context
  graph structure Get graph structure as plain ASCII tree (legacy)
  graph lint      Lint graph for complexity violations and warnings
  graph rename    Rename a file and update all references
  graph mv        Move a file or folder and update all references
  search          Search nodes by query
  help            Show this help`

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

    for (let index: number = 0; index < argv.length; index += 1) {
        const current: string = argv[index]

        if (current === '--json') {
            continue
        }

        if (current === '--port' || current === '-p') {
            const rawPort: string | undefined = argv[index + 1]
            if (!rawPort) {
                error(`${current} requires a value`)
            }

            port = parsePort(rawPort)
            index += 1
            continue
        }

        if (current.startsWith('--port=')) {
            port = parsePort(current.slice('--port='.length))
            continue
        }

        if (current === '--terminal' || current === '-t') {
            const rawTerminalId: string | undefined = argv[index + 1]
            if (!rawTerminalId) {
                error(`${current} requires a value`)
            }

            terminalId = rawTerminalId
            index += 1
            continue
        }

        if (current.startsWith('--terminal=')) {
            terminalId = current.slice('--terminal='.length)
            continue
        }

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
        case 'help':
        case undefined:
            printHelp()
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
                './commands/graph.ts',
                'graphCreate',
                'Graph commands are not available in this build yet'
            )
            await graphCreate(port, terminalId, args)
            return
        }
        case 'index': {
            const graphIndex: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphIndex',
                'Graph commands are not available in this build yet'
            )
            await graphIndex(port, terminalId, args)
            return
        }
        case 'search': {
            const graphSearch: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphSearch',
                'Graph commands are not available in this build yet'
            )
            await graphSearch(port, terminalId, args)
            return
        }
        case 'unseen': {
            const graphUnseen: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphUnseen',
                'Graph commands are not available in this build yet'
            )
            await graphUnseen(port, terminalId, args)
            return
        }
        case 'structure': {
            const graphStructure: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphStructure',
                'Graph commands are not available in this build yet'
            )
            await graphStructure(port, terminalId, args)
            return
        }
        case 'view': {
            const graphView: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphView',
                'Graph commands are not available in this build yet'
            )
            await graphView(port, terminalId, args)
            return
        }
        case 'lint': {
            const graphLintCommand: CommandHandler = await loadDeferredHandler(
                './commands/graph.ts',
                'graphLintCommand',
                'Graph commands are not available in this build yet'
            )
            await graphLintCommand(port, terminalId, args)
            return
        }
        case 'rename': {
            const graphRename: CommandHandler = await loadDeferredHandler(
                './commands/rename.ts',
                'graphRename',
                'Rename command is not available in this build yet'
            )
            await graphRename(port, terminalId, args)
            return
        }
        case 'mv': {
            const graphMove: CommandHandler = await loadDeferredHandler(
                './commands/move.ts',
                'graphMove',
                'Move command is not available in this build yet'
            )
            await graphMove(port, terminalId, args)
            return
        }
        case 'help':
        case undefined:
            printHelp()
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
        './commands/search.ts',
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

    if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
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
