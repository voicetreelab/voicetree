import {existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from './output'

const BRAIN = resolve(join(homedir(), 'brain'))

export type PathMapping = {
    oldAbsPath: string
    newAbsPath: string
}

type GraphMovePlan = {
    kind: 'file' | 'folder'
    sourceAbsPath: string
    destinationAbsPath: string
    mappings: PathMapping[]
    nonMarkdownFiles: string[]
}

type GraphMoveOptions = {
    usage: string
    verb: string
    dryRunVerb: string
    requireFile?: boolean
}

export type ReferenceUpdateSummary = {
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
}

type GraphMoveResult = {
    kind: 'file' | 'folder'
    movedMarkdownFiles: number
    movedFiles: Array<{from: string; to: string}>
    dryRun: boolean
    filesChanged: string[]
    referencesUpdated: number
    details: Array<{file: string; count: number}>
    warnings: string[]
    nonMarkdownFiles: string[]
}

function shouldSkipPath(fullPath: string): boolean {
    return fullPath.includes('/.voicetree/') || fullPath.includes('/node_modules/')
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
            if (shouldSkipPath(fullPath)) continue
            if (entry.isDirectory()) {
                walk(fullPath)
                continue
            }
            if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath)
        }
    }

    walk(dir)
    return results.sort()
}

function findNonMdFiles(dir: string): string[] {
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
            if (shouldSkipPath(fullPath)) continue
            if (entry.isDirectory()) {
                walk(fullPath)
                continue
            }
            if (entry.isFile() && !entry.name.endsWith('.md')) results.push(fullPath)
        }
    }

    walk(dir)
    return results.sort()
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildReferencePatterns(
    oldAbsPath: string,
    newAbsPath: string,
    projectRoot: string
): Array<{pattern: RegExp; replacement: string}> {
    const patterns: Array<{pattern: RegExp; replacement: string}> = []

    const oldBasename = basename(oldAbsPath, '.md')
    const oldBasenameWithExt = basename(oldAbsPath)
    const newBasename = basename(newAbsPath, '.md')
    const newBasenameWithExt = basename(newAbsPath)

    const oldRelFromProject = relative(projectRoot, oldAbsPath)
    const newRelFromProject = relative(projectRoot, newAbsPath)

    const oldTildePath = `~/brain/${oldRelFromProject}`
    const newTildePath = `~/brain/${newRelFromProject}`

    if (oldRelFromProject.includes('/')) {
        const oldRelNoExt = oldRelFromProject.replace(/\.md$/, '')
        const newRelNoExt = newRelFromProject.replace(/\.md$/, '')

        patterns.push({
            pattern: new RegExp(`\\[\\[${escapeRegex(oldRelFromProject)}(\\|[^\\]]*)?\\]\\]`, 'g'),
            replacement: `[[${newRelFromProject}$1]]`,
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

    if (oldRelFromProject.includes('/')) {
        patterns.push({
            pattern: new RegExp(`(?<!\\[\\[)${escapeRegex(oldRelFromProject)}(?!.*\\]\\])`, 'g'),
            replacement: newRelFromProject,
        })
    }

    return patterns
}

export function resolveFilePath(inputPath: string, projectRoot: string): string {
    if (inputPath.startsWith('~/brain/')) {
        return join(projectRoot, inputPath.slice('~/brain/'.length))
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

function parseMoveArgs(args: string[], usage: string): {dryRun: boolean; projectRoot: string; positionals: string[]} {
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

    if (positionals.length !== 2) {
        error(usage)
    }

    return {dryRun, projectRoot, positionals}
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
            nonMarkdownFiles: findNonMdFiles(sourceAbsPath),
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
        nonMarkdownFiles: [],
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

export function updateReferences(
    projectRoot: string,
    mappings: PathMapping[],
    dryRun: boolean
): ReferenceUpdateSummary {
    const patterns = mappings.flatMap(({oldAbsPath, newAbsPath}) =>
        buildReferencePatterns(oldAbsPath, newAbsPath, projectRoot)
    )
    const mdFiles = findMdFiles(projectRoot)

    const summary: ReferenceUpdateSummary = {
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
            const relativePath = relative(projectRoot, filePath)
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

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

function buildWarnings(nonMarkdownFiles: string[], dryRun: boolean): string[] {
    if (nonMarkdownFiles.length === 0) return []

    return [
        `${formatCount(nonMarkdownFiles.length, 'non-Markdown file')} ${dryRun ? 'would also be moved' : 'will also be moved'} without reference updates.`,
    ]
}

function formatMoveResult(result: GraphMoveResult, verb: string, dryRunVerb: string): string {
    const action = result.dryRun ? dryRunVerb : verb
    const lines: string[] = [
        `${action} ${result.kind} (${formatCount(result.movedMarkdownFiles, 'file')}, ${formatCount(result.referencesUpdated, 'reference updated', 'references updated')}):`,
    ]

    for (const movedFile of result.movedFiles) {
        lines.push(`  ${movedFile.from} -> ${movedFile.to}`)
    }

    if (result.details.length > 0) {
        lines.push('')
        lines.push('References updated:')
        for (const detail of result.details) {
            lines.push(`  ${detail.file} (${detail.count})`)
        }
    }

    if (result.warnings.length > 0) {
        lines.push('')
        lines.push('Warnings:')
        for (const warning of result.warnings) {
            lines.push(`  ${warning}`)
        }
        for (const filePath of result.nonMarkdownFiles) {
            lines.push(`  ${filePath}`)
        }
    }

    return lines.join('\n')
}

export async function runGraphMove(args: string[], options: GraphMoveOptions): Promise<void> {
    const {dryRun, projectRoot, positionals} = parseMoveArgs(args, options.usage)
    const sourceAbsPath = resolveFilePath(positionals[0], projectRoot)
    const destinationAbsPath = resolveFilePath(positionals[1], projectRoot)

    if (!existsSync(sourceAbsPath)) {
        error(`Source path does not exist: ${sourceAbsPath}`)
    }

    const plan = buildMovePlan(sourceAbsPath, destinationAbsPath)
    validateMovePlan(plan, options)

    const referenceSummary = updateReferences(projectRoot, plan.mappings, dryRun)
    performFilesystemMove(plan, dryRun)

    const movedFiles = plan.mappings.map(({oldAbsPath, newAbsPath}) => ({
        from: relative(projectRoot, oldAbsPath),
        to: relative(projectRoot, newAbsPath),
    }))
    const nonMarkdownFiles = plan.nonMarkdownFiles.map((filePath) => relative(projectRoot, filePath))

    const result: GraphMoveResult = {
        kind: plan.kind,
        movedMarkdownFiles: plan.mappings.length,
        movedFiles,
        dryRun,
        filesChanged: referenceSummary.filesChanged,
        referencesUpdated: referenceSummary.referencesUpdated,
        details: referenceSummary.details,
        warnings: buildWarnings(nonMarkdownFiles, dryRun),
        nonMarkdownFiles,
    }

    output(result, (data: unknown) => formatMoveResult(data as GraphMoveResult, options.verb, options.dryRunVerb))
}

export async function graphMove(
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    await runGraphMove(args, {
        usage: 'Usage: vt graph mv <source-path> <dest-path> [--dry-run] [--project PATH]',
        verb: 'Moved',
        dryRunVerb: 'Would move',
    })
}
