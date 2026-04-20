import path from 'node:path'
import {
    DEFAULT_LINT_CONFIG,
    formatLintReportHuman,
    formatLintReportJson,
    lintGraph,
    type LintConfig,
} from '@vt/graph-tools/node'
import {error, isJsonMode} from '../../output.ts'
import {handleCliError} from '../../util/exitCodes.ts'
import {getRequiredValue} from './args.ts'
import {withDaemonGraphSnapshot} from './snapshot.ts'

export async function graphLintCommand(port: number, terminalId: string | undefined, args: string[]): Promise<void> {
    void port
    void terminalId

    if (args.length === 0) {
        error('Usage: vt graph lint <folder-path> [--max-arity N] [--coupling-threshold N] [--cross-ref-threshold N]')
    }

    const folderPath: string = args[0]
    const config: LintConfig = { ...DEFAULT_LINT_CONFIG }

    for (let index: number = 1; index < args.length; index += 1) {
        const arg: string = args[index]
        if (arg === '--max-arity') {
            const val: string = getRequiredValue(args, index + 1, '--max-arity')
            config.maxArity = Number(val)
            config.maxAttentionItems = Number(val)
            index += 1
            continue
        }
        if (arg === '--coupling-threshold') {
            const val: string = getRequiredValue(args, index + 1, '--coupling-threshold')
            config.highCouplingThreshold = Number(val)
            index += 1
            continue
        }
        if (arg === '--cross-ref-threshold') {
            const val: string = getRequiredValue(args, index + 1, '--cross-ref-threshold')
            config.wideCrossRefThreshold = Number(val)
            index += 1
            continue
        }
        error(`Unknown argument: ${arg}`)
    }

    try {
        const resolvedFolderPath: string = path.resolve(folderPath)
        const report: ReturnType<typeof lintGraph> = await withDaemonGraphSnapshot(
            resolvedFolderPath,
            (snapshotRoot: string): ReturnType<typeof lintGraph> => lintGraph(snapshotRoot, config),
        )

        if (isJsonMode()) {
            console.log(formatLintReportJson(report))
        } else {
            console.log(formatLintReportHuman(report))
        }
    } catch (lintError: unknown) {
        handleCliError(lintError)
    }
}
