import path from 'node:path'
import {getGraphStructure} from '@vt/graph-tools/node'
import {error, output} from '../../output.ts'
import {handleCliError} from '../../util/exitCodes.ts'
import {withDaemonGraphSnapshot} from './snapshot.ts'

export async function graphStructure(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph structure <folder-path> [--with-summaries|--no-summaries]')
    }

    let folderPath: string | undefined
    let withSummaries: boolean | undefined

    for (const arg of args) {
        if (arg === '--with-summaries') {
            if (withSummaries === false) {
                error('Cannot combine --with-summaries and --no-summaries')
            }
            withSummaries = true
            continue
        }

        if (arg === '--no-summaries') {
            if (withSummaries === true) {
                error('Cannot combine --with-summaries and --no-summaries')
            }
            withSummaries = false
            continue
        }

        if (arg.startsWith('--')) {
            error(`Unknown argument: ${arg}`)
        }

        if (folderPath !== undefined) {
            error(`Unexpected argument: ${arg}`)
        }

        folderPath = arg
    }

    if (!folderPath) {
        error('Usage: vt graph structure <folder-path> [--with-summaries|--no-summaries]')
    }

    try {
        const resolvedFolderPath: string = path.resolve(folderPath)
        const result: ReturnType<typeof getGraphStructure> = await withDaemonGraphSnapshot(
            resolvedFolderPath,
            (snapshotRoot: string): ReturnType<typeof getGraphStructure> =>
                getGraphStructure(snapshotRoot, {withSummaries}),
        )

        if (result.nodeCount === 0) {
            output({message: '0 nodes found', folderPath, withSummaries})
        } else {
            console.log(`${result.nodeCount} nodes in ${folderPath}`)
            console.log('')
            console.log(result.ascii)
            if (result.orphanCount && result.orphanCount > 0) {
                console.log(`\nOrphans: ${result.orphanCount}`)
            }
        }
    } catch (toolError: unknown) {
        handleCliError(toolError)
    }
}
