import path from 'node:path'
import {renderAutoView} from '@vt/graph-tools/node'
import {error, output} from '../../output.ts'
import {handleCliError} from '../../util/exitCodes.ts'
import {withDaemonGraphSnapshot} from './snapshot.ts'

export async function graphStructure(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph structure <folder-path>')
    }

    let folderPath: string | undefined

    for (const arg of args) {
        if (arg === '--with-summaries' || arg === '--no-summaries') {
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
        error('Usage: vt graph structure <folder-path>')
    }

    try {
        const resolvedFolderPath: string = path.resolve(folderPath)
        const ascii: string = await withDaemonGraphSnapshot(
            resolvedFolderPath,
            (snapshotRoot: string): string => renderAutoView(snapshotRoot).output,
        )

        if (!ascii) {
            output({message: '0 nodes found', folderPath})
        } else {
            console.log(ascii)
        }
    } catch (toolError: unknown) {
        handleCliError(toolError)
    }
}
