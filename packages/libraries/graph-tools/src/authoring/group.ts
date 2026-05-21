import {existsSync, mkdirSync, renameSync, statSync} from 'node:fs'
import {basename, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from './output'
import {resolveFilePath, updateReferences, type PathMapping} from './move'

const BRAIN = resolve(join(homedir(), 'brain'))

type GraphGroupResult = {
    folderCreated: boolean
    movedFiles: Array<{from: string; to: string}>
    dryRun: boolean
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

const USAGE = 'Usage: vt graph group <folder-path> <node1> <node2> ... [--dry-run] [--vault PATH]'

function parseGroupArgs(args: string[]): {dryRun: boolean; vaultRoot: string; positionals: string[]} {
    let dryRun = false
    let vaultRoot = BRAIN
    const positionals: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--dry-run') {
            dryRun = true
            continue
        }
        if (arg === '--vault') {
            const val = args[i + 1]
            if (!val) error('--vault requires a value')
            vaultRoot = resolve(val)
            i++
            continue
        }
        positionals.push(arg)
    }

    if (positionals.length < 2) {
        error(USAGE)
    }

    return {dryRun, vaultRoot, positionals}
}

function formatGroupResult(result: GraphGroupResult): string {
    const action = result.dryRun ? 'Would group' : 'Grouped'
    const lines: string[] = [
        `${action} ${result.movedFiles.length} file${result.movedFiles.length === 1 ? '' : 's'}:`,
    ]

    for (const moved of result.movedFiles) {
        lines.push(`  ${moved.from} -> ${moved.to}`)
    }

    if (result.details.length > 0) {
        lines.push('')
        lines.push('References updated:')
        for (const detail of result.details) {
            lines.push(`  ${detail.file} (${detail.count})`)
        }
    }

    return lines.join('\n')
}

export async function graphGroup(
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const {dryRun, vaultRoot, positionals} = parseGroupArgs(args)
    const [folderPath, ...nodePaths] = positionals

    const folderAbsPath = resolveFilePath(folderPath, vaultRoot)

    const mappings: PathMapping[] = []
    for (const nodePath of nodePaths) {
        const sourceAbsPath = resolveFilePath(nodePath, vaultRoot)
        if (!existsSync(sourceAbsPath)) {
            error(`Source does not exist: ${nodePath}`)
        }
        if (!statSync(sourceAbsPath).isFile()) {
            error(`Source is not a file: ${nodePath}`)
        }
        const destAbsPath = join(folderAbsPath, basename(sourceAbsPath))
        if (existsSync(destAbsPath)) {
            error(`Destination already exists: ${relative(vaultRoot, destAbsPath)}`)
        }
        mappings.push({oldAbsPath: sourceAbsPath, newAbsPath: destAbsPath})
    }

    let folderCreated = false
    if (!existsSync(folderAbsPath)) {
        if (!dryRun) {
            mkdirSync(folderAbsPath, {recursive: true})
        }
        folderCreated = true
    }

    const refSummary = updateReferences(vaultRoot, mappings, dryRun)

    if (!dryRun) {
        for (const {oldAbsPath, newAbsPath} of mappings) {
            renameSync(oldAbsPath, newAbsPath)
        }
    }

    const result: GraphGroupResult = {
        folderCreated,
        movedFiles: mappings.map(({oldAbsPath, newAbsPath}) => ({
            from: relative(vaultRoot, oldAbsPath),
            to: relative(vaultRoot, newAbsPath),
        })),
        dryRun,
        filesChanged: refSummary.filesChanged,
        referencesUpdated: refSummary.referencesUpdated,
        details: refSummary.details,
    }

    output(result, (data: unknown) => formatGroupResult(data as GraphGroupResult))
}
