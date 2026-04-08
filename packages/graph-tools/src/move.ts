import {existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from './output'

const BRAIN = resolve(join(homedir(), 'brain'))

type PathMapping = {
    oldAbsPath: string
    newAbsPath: string
}

type GraphMovePlan = {
    kind: 'file' | 'folder'
    sourceAbsPath: string
    destinationAbsPath: string
    mappings: PathMapping[]
}

type GraphMoveOptions = {
    usage: string
    verb: string
    requireFile?: boolean
}

type ReferenceUpdateSummary = {
    filesScanned: number
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

type GraphMoveResult = {
    sourcePath: string
    destinationPath: string
    kind: 'file' | 'folder'
    movedMarkdownFiles: number
    dryRun: boolean
    filesScanned: number
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

function findMdFiles(dir: string): string[] {
    const results: string[] = []

    function walk(currentDir: string): void {
        let entries
        try {
            entries = readdirSync(currentDir, {withFileTypes: true})
        } catch {
            return
        }

        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name)
            if (fullPath.includes('/.voicetree/') || fullPath.includes('/node_modules/')) continue
            if (entry.isDirectory()) {
                walk(fullPath)
                continue
            }
            if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath)
        }
    }

    walk(dir)
    return results
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildReferencePatterns(
    oldAbsPath: string,
    newAbsPath: string,
    vaultRoot: string
): Array<{pattern: RegExp; replacement: string}> {
    const patterns: Array<{pattern: RegExp; replacement: string}> = []

    const oldBasename = basename(oldAbsPath, '.md')
    const oldBasenameWithExt = basename(oldAbsPath)
    const newBasename = basename(newAbsPath, '.md')
    const newBasenameWithExt = basename(newAbsPath)

    const oldRelFromVault = relative(vaultRoot, oldAbsPath)
    const newRelFromVault = relative(vaultRoot, newAbsPath)

    const oldTildePath = `~/brain/${oldRelFromVault}`
    const newTildePath = `~/brain/${newRelFromVault}`

    if (oldRelFromVault.includes('/')) {
        const oldRelNoExt = oldRelFromVault.replace(/\.md$/, '')
        const newRelNoExt = newRelFromVault.replace(/\.md$/, '')

        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldRelFromVault)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newRelFromVault}$1]]`,
        })
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldRelNoExt)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newRelNoExt}$1]]`,
        })
    }

    if (oldBasename !== newBasename) {
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldBasenameWithExt)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newBasenameWithExt}$1]]`,
        })
        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldBasename)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newBasename}$1]]`,
        })
    }

    patterns.push({
        pattern: new RegExp(escapeRegex(oldTildePath), 'g'),
        replacement: newTildePath,
    })

    patterns.push({
        pattern: new RegExp(escapeRegex(oldAbsPath), 'g'),
        replacement: newAbsPath,
    })

    if (oldRelFromVault.includes('/')) {
        patterns.push({
            pattern: new RegExp(`(?<!\\[\\[)${escapeRegex(oldRelFromVault)}(?!.*\\]\\])`, 'g'),
            replacement: newRelFromVault,
        })
    }

    return patterns
}

function resolveFilePath(inputPath: string, vaultRoot: string): string {
    if (inputPath.startsWith('~/brain/')) {
        return join(vaultRoot, inputPath.slice('~/brain/'.length))
    }
    if (inputPath.startsWith('~/')) {
        return join(homedir(), inputPath.slice(2))
    }
    if (inputPath.startsWith('/')) {
        return inputPath
    }
    return resolve(inputPath)
}

function isDescendantPath(parentPath: string, childPath: string): boolean {
    const relativePath = relative(parentPath, childPath)
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function parseMoveArgs(args: string[], usage: string): {dryRun: boolean; vaultRoot: string; positionals: string[]} {
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

    if (positionals.length !== 2) {
        error(usage)
    }

    return {dryRun, vaultRoot, positionals}
}

function buildMovePlan(sourceAbsPath: string, destinationAbsPath: string): GraphMovePlan {
    const sourceStat = statSync(sourceAbsPath)

    if (sourceStat.isDirectory()) {
        const markdownFiles = findMdFiles(sourceAbsPath)
        return {
            kind: 'folder',
            sourceAbsPath,
            destinationAbsPath,
            mappings: markdownFiles.map((oldAbsPath) => ({
                oldAbsPath,
                newAbsPath: join(destinationAbsPath, relative(sourceAbsPath, oldAbsPath)),
            })),
        }
    }

    if (!sourceStat.isFile()) {
        error(`Unsupported source type: ${sourceAbsPath}`)
    }

    return {
        kind: 'file',
        sourceAbsPath,
        destinationAbsPath,
        mappings: [{oldAbsPath: sourceAbsPath, newAbsPath: destinationAbsPath}],
    }
}

function validateMovePlan(plan: GraphMovePlan, options: GraphMoveOptions): void {
    if (plan.sourceAbsPath === plan.destinationAbsPath) {
        error(`Source and destination are the same: ${plan.sourceAbsPath}`)
    }

    if (options.requireFile && plan.kind !== 'file') {
        error(`graph rename only supports files: ${plan.sourceAbsPath}`)
    }

    if (existsSync(plan.destinationAbsPath)) {
        error(`Destination already exists: ${plan.destinationAbsPath}`)
    }

    const destinationParent = dirname(plan.destinationAbsPath)
    if (!existsSync(destinationParent)) {
        error(`Target directory does not exist: ${destinationParent}`)
    }

    if (plan.kind === 'folder' && isDescendantPath(plan.sourceAbsPath, plan.destinationAbsPath)) {
        error(`Cannot move a folder into itself: ${plan.destinationAbsPath}`)
    }

    for (const mapping of plan.mappings) {
        if (existsSync(mapping.newAbsPath)) {
            error(`Destination already exists: ${mapping.newAbsPath}`)
        }
    }
}

function updateReferences(
    vaultRoot: string,
    mappings: PathMapping[],
    dryRun: boolean
): ReferenceUpdateSummary {
    const patterns = mappings.flatMap(({oldAbsPath, newAbsPath}) =>
        buildReferencePatterns(oldAbsPath, newAbsPath, vaultRoot)
    )
    const mdFiles = findMdFiles(vaultRoot)

    const summary: ReferenceUpdateSummary = {
        filesScanned: mdFiles.length,
        filesChanged: [],
        referencesUpdated: 0,
        details: [],
    }

    for (const filePath of mdFiles) {
        const originalContent = readFileSync(filePath, 'utf8')
        let updatedContent = originalContent
        let fileRefCount = 0

        for (const {pattern, replacement} of patterns) {
            pattern.lastIndex = 0
            const matches = updatedContent.match(pattern)
            if (matches) {
                fileRefCount += matches.length
                updatedContent = updatedContent.replace(pattern, replacement)
            }
        }

        if (updatedContent !== originalContent) {
            const relativePath = relative(vaultRoot, filePath)
            summary.filesChanged.push(relativePath)
            summary.referencesUpdated += fileRefCount
            summary.details.push({file: relativePath, count: fileRefCount})

            if (!dryRun) {
                writeFileSync(filePath, updatedContent, 'utf8')
            }
        }
    }

    return summary
}

function performFilesystemMove(plan: GraphMovePlan, dryRun: boolean): void {
    if (dryRun) return
    renameSync(plan.sourceAbsPath, plan.destinationAbsPath)
}

function formatMoveResult(result: GraphMoveResult, verb: string): string {
    const prefix = result.dryRun ? '[DRY RUN] ' : ''
    const lines: string[] = [
        `${prefix}${verb} ${result.kind}: ${result.sourcePath} -> ${result.destinationPath}`,
        `Moved markdown files: ${result.movedMarkdownFiles}`,
        `Scanned: ${result.filesScanned} files`,
        `Changed: ${result.filesChanged.length} files (${result.referencesUpdated} references)`,
    ]

    if (result.details.length > 0) {
        lines.push('')
        lines.push('Files updated:')
        for (const detail of result.details) {
            lines.push(`  ${detail.file} (${detail.count} refs)`)
        }
    }

    return lines.join('\n')
}

export async function runGraphMove(args: string[], options: GraphMoveOptions): Promise<void> {
    const {dryRun, vaultRoot, positionals} = parseMoveArgs(args, options.usage)
    const sourceAbsPath = resolveFilePath(positionals[0], vaultRoot)
    const destinationAbsPath = resolveFilePath(positionals[1], vaultRoot)

    if (!existsSync(sourceAbsPath)) {
        error(`Source path does not exist: ${sourceAbsPath}`)
    }

    const plan = buildMovePlan(sourceAbsPath, destinationAbsPath)
    validateMovePlan(plan, options)

    const referenceSummary = updateReferences(vaultRoot, plan.mappings, dryRun)
    performFilesystemMove(plan, dryRun)

    const result: GraphMoveResult = {
        sourcePath: relative(vaultRoot, sourceAbsPath),
        destinationPath: relative(vaultRoot, destinationAbsPath),
        kind: plan.kind,
        movedMarkdownFiles: plan.mappings.length,
        dryRun,
        filesScanned: referenceSummary.filesScanned,
        filesChanged: referenceSummary.filesChanged,
        referencesUpdated: referenceSummary.referencesUpdated,
        details: referenceSummary.details,
    }

    output(result, (data: unknown) => formatMoveResult(data as GraphMoveResult, options.verb))
}

export async function graphMove(
    _port: number,
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    await runGraphMove(args, {
        usage: 'Usage: vt graph mv <source-path> <dest-path> [--dry-run] [--vault PATH]',
        verb: 'Moved',
    })
}
