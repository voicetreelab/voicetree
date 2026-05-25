import path from 'node:path'
import {GraphDbClient, readPortFile, type ViewResponse} from '@vt/graph-db-client'
import {renderAutoView, renderGraphView, type ViewFormat} from '@vt/graph-tools/node'
import {error, handleCliError} from '../cliDeps'
import {resolveGraphVault} from './snapshot'

export async function graphStructure(terminalId: string | undefined, args: string[]): Promise<void> {
    void terminalId

    let folderPath: string | undefined
    let format: ViewFormat = 'ascii'
    let showCrossEdges: boolean = true
    const collapsedFolders: string[] = []
    const selectedIds: string[] = []
    const expandIds: string[] = []
    let autoExplicit: boolean | undefined
    let explicitRender: boolean = false
    let budget: number = 30
    let budgetExplicit: boolean = false

    for (let i: number = 0; i < args.length; i += 1) {
        const arg: string = args[i]
        if (arg === '--auto') { autoExplicit = true; continue }
        if (arg === '--no-auto') { autoExplicit = false; continue }
        if (arg === '--budget') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--budget requires a value')
            const parsed: number = Number.parseInt(next, 10)
            if (!Number.isInteger(parsed) || parsed < 1) error('--budget requires a positive integer')
            budget = parsed
            budgetExplicit = true
            i += 1
            continue
        }
        if (arg.startsWith('--budget=')) {
            const parsed: number = Number.parseInt(arg.slice('--budget='.length), 10)
            if (!Number.isInteger(parsed) || parsed < 1) error('--budget requires a positive integer')
            budget = parsed
            budgetExplicit = true
            continue
        }
        if (arg === '--expand') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--expand requires a folder id argument')
            expandIds.push(next)
            i += 1
            continue
        }
        if (arg.startsWith('--expand=')) {
            expandIds.push(arg.slice('--expand='.length))
            continue
        }
        if (arg === '--mermaid') { format = 'mermaid'; explicitRender = true; continue }
        if (arg === '--ascii') { format = 'ascii'; explicitRender = true; continue }
        if (arg.startsWith('--format=')) {
            const value: string = arg.slice('--format='.length)
            if (value !== 'ascii' && value !== 'mermaid') error(`Unknown format: ${value}`)
            format = value
            explicitRender = true
            continue
        }
        if (arg === '--no-cross-edges') { showCrossEdges = false; explicitRender = true; continue }
        if (arg === '--collapse') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--collapse requires a folder argument')
            collapsedFolders.push(next)
            explicitRender = true
            i += 1
            continue
        }
        if (arg.startsWith('--collapse=')) {
            collapsedFolders.push(arg.slice('--collapse='.length))
            explicitRender = true
            continue
        }
        if (arg === '--select') {
            const next: string | undefined = args[i + 1]
            if (!next || next.startsWith('--')) error('--select requires a node id argument')
            selectedIds.push(next)
            explicitRender = true
            i += 1
            continue
        }
        if (arg.startsWith('--select=')) {
            selectedIds.push(arg.slice('--select='.length))
            explicitRender = true
            continue
        }
        if (arg.startsWith('--')) error(`Unknown argument: ${arg}`)
        if (folderPath !== undefined) error(`Unexpected argument: ${arg}`)
        folderPath = arg
    }

    const autoMode: boolean = autoExplicit ?? !explicitRender
    const resolvedFolderPath: string = path.resolve(folderPath ?? process.cwd())

    try {
        if (autoMode) {
            if (explicitRender) {
                error('--auto cannot be combined with --ascii/--mermaid/--format/--collapse/--select/--no-cross-edges')
            }
            const output: string = await viewViaDaemon(resolvedFolderPath, budget, expandIds)
            console.log(output)
            return
        }

        if (budgetExplicit) {
            error('--budget can only be used with the default auto view or --auto')
        }

        const result: ReturnType<typeof renderGraphView> = renderGraphView(resolvedFolderPath, {
            format,
            showCrossEdges,
            collapsedFolders,
            selectedIds,
        })
        console.log(result.output)
        if (format === 'ascii') {
            console.log(`\n${result.nodeCount} nodes — ${result.folderNodeCount} folder nodes, ${result.virtualFolderCount} virtual folders, ${result.fileNodeCount} files`)
        }
    } catch (toolError: unknown) {
        handleCliError(toolError)
    }
}

async function viewViaDaemon(folderPath: string, budget: number, expandIds: string[]): Promise<string> {
    const vault: string = resolveGraphVault(folderPath)
    const daemonPort: number | null = await readPortFile(vault)

    if (daemonPort !== null) {
        try {
            const client: GraphDbClient = new GraphDbClient({baseUrl: `http://127.0.0.1:${daemonPort}`})
            const response: ViewResponse = await client.getView('cli', {budget, expand: expandIds})
            return response.output
        } catch (err: unknown) {
            if (err instanceof TypeError || (err instanceof Error && err.message.toLowerCase().includes('fetch'))) {
                // Daemon unreachable — fall through to local rendering
            } else {
                throw err
            }
        }
    }

    const {output} = renderAutoView(folderPath, {budget})
    return output
}
