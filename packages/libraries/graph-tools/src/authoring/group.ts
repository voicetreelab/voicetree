import {existsSync, mkdirSync, renameSync, statSync} from 'node:fs'
import {basename, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from './output'
import {resolveFilePath, updateReferences, type PathMapping} from './move'

const BRAIN = resolve(join(homedir(), 'brain'))

export type GraphGroupResult = {
    folderCreated: boolean
    movedFiles: Array<{from: string; to: string}>
    dryRun: boolean
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

/**
 * Core of `vt graph group`: move a set of node files into `folderAbsPath`
 * (created if absent) and rewrite every project reference to them. Shared by the
 * `group` command and `vt graph garden --apply` so both paths move files
 * identically. Fails fast (via {@link error}) if a source is missing/not a file
 * or a destination basename already exists in the target folder.
 */
export function groupNodesIntoFolder(
    projectRoot: string,
    folderAbsPath: string,
    sourceAbsPaths: readonly string[],
    dryRun: boolean,
): GraphGroupResult {
    const mappings: PathMapping[] = []
    for (const sourceAbsPath of sourceAbsPaths) {
        if (!existsSync(sourceAbsPath)) {
            error(`Source does not exist: ${relative(projectRoot, sourceAbsPath)}`)
        }
        if (!statSync(sourceAbsPath).isFile()) {
            error(`Source is not a file: ${relative(projectRoot, sourceAbsPath)}`)
        }
        const destAbsPath = join(folderAbsPath, basename(sourceAbsPath))
        if (existsSync(destAbsPath)) {
            error(`Destination already exists: ${relative(projectRoot, destAbsPath)}`)
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

    const refSummary = updateReferences(projectRoot, mappings, dryRun)

    if (!dryRun) {
        for (const {oldAbsPath, newAbsPath} of mappings) {
            renameSync(oldAbsPath, newAbsPath)
        }
    }

    return {
        folderCreated,
        movedFiles: mappings.map(({oldAbsPath, newAbsPath}) => ({
            from: relative(projectRoot, oldAbsPath),
            to: relative(projectRoot, newAbsPath),
        })),
        dryRun,
        filesChanged: refSummary.filesChanged,
        referencesUpdated: refSummary.referencesUpdated,
        details: refSummary.details,
    }
}

const USAGE = 'Usage: vt graph group <folder-path> <node1> <node2> ... [--dry-run] [--project PATH]'

function parseGroupArgs(args: string[]): {dryRun: boolean; projectRoot: string; positionals: string[]} {
    let dryRun = false
    let projectRoot = BRAIN
    const positionals: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--dry-run') {
            dryRun = true
            continue
        }
        if (arg === '--project') {
            const val = args[i + 1]
            if (!val) error('--project requires a value')
            projectRoot = resolve(val)
            i++
            continue
        }
        positionals.push(arg)
    }

    if (positionals.length < 2) {
        error(USAGE)
    }

    return {dryRun, projectRoot, positionals}
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
    const {dryRun, projectRoot, positionals} = parseGroupArgs(args)
    const [folderPath, ...nodePaths] = positionals

    const folderAbsPath = resolveFilePath(folderPath, projectRoot)
    const sourceAbsPaths = nodePaths.map((nodePath) => resolveFilePath(nodePath, projectRoot))

    const result = groupNodesIntoFolder(projectRoot, folderAbsPath, sourceAbsPaths, dryRun)

    output(result, (data: unknown) => formatGroupResult(data as GraphGroupResult))
}
