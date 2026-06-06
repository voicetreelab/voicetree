import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {canonicalLinkText} from './linkForm'
import {error, output} from './output'
import type {PathMapping, ReferenceUpdateSummary} from './move'

const BRAIN = resolve(join(homedir(), 'brain'))
const WIKILINK_REGEX: RegExp = /\[\[([^\]\n\r]+)\]\]/g

export type RelinkOptions = {
    dryRun: boolean
    mappings?: readonly PathMapping[]
}

export type RelinkResult = ReferenceUpdateSummary & {
    dryRun: boolean
}

export type RelinkDiskIndex = {
    files: readonly string[]
    nodes: Record<string, {absoluteFilePathIsID: string; outgoingEdges: readonly []; contentWithoutYamlOrLinks: string; nodeUIMetadata: any}>
    nodeByBaseName: Map<string, string[]>
    postMovePathByPreMovePath: ReadonlyMap<string, string>
}

function shouldSkipPath(fullPath: string): boolean {
    return fullPath.includes('/.voicetree/') || fullPath.includes('/node_modules/') || fullPath.includes('/ctx-nodes/')
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

function buildVirtualPathMap(mappings: readonly PathMapping[]): Map<string, string> {
    return new Map(mappings.map(({oldAbsPath, newAbsPath}) => [oldAbsPath, newAbsPath]))
}

export function buildRelinkDiskIndex(projectRoot: string, mappings: readonly PathMapping[] = []): RelinkDiskIndex {
    const virtualPaths = buildVirtualPathMap(mappings)
    const files = findMdFiles(projectRoot)
    const postMoveFiles = files.map(file => virtualPaths.get(file) ?? file)
    const nodes: RelinkDiskIndex['nodes'] = {}
    const nodeByBaseName = new Map<string, string[]>()

    for (const file of postMoveFiles) {
        nodes[file] = {
            absoluteFilePathIsID: file,
            outgoingEdges: [],
            contentWithoutYamlOrLinks: '',
            nodeUIMetadata: {},
        }
        const baseName = basename(file, '.md')
        nodeByBaseName.set(baseName, [...(nodeByBaseName.get(baseName) ?? []), file])
    }

    return {files, nodes, nodeByBaseName, postMovePathByPreMovePath: virtualPaths}
}

function normalizeLinkTarget(rawTarget: string): string {
    return rawTarget.split('|')[0]?.trim() ?? ''
}

function projectRelativeCandidate(rawTarget: string, projectRoot: string, index: RelinkDiskIndex): string | undefined {
    if (rawTarget.startsWith('/') || !rawTarget.includes('/')) return undefined
    const candidate = join(projectRoot, rawTarget.endsWith('.md') ? rawTarget : `${rawTarget}.md`)
    if (!existsSync(candidate)) return undefined
    return index.postMovePathByPreMovePath.get(candidate) ?? candidate
}

function absoluteCandidate(rawTarget: string, index: RelinkDiskIndex): string | undefined {
    if (!isAbsolute(rawTarget)) return undefined
    const candidate = rawTarget.endsWith('.md') ? rawTarget : `${rawTarget}.md`
    if (!existsSync(candidate)) return undefined
    return index.postMovePathByPreMovePath.get(candidate) ?? candidate
}

function resolveTargetPath(rawTarget: string, projectRoot: string, index: RelinkDiskIndex): string | undefined {
    const target = normalizeLinkTarget(rawTarget)
    if (!target) return undefined
    return absoluteCandidate(target, index)
        ?? projectRelativeCandidate(target, projectRoot, index)
        ?? findBestMatchingNode(target, index.nodes as any, index.nodeByBaseName as any)
}

export function relinkContent(
    content: string,
    sourceNodeAbsPath: string,
    projectRoot: string,
    index: RelinkDiskIndex
): {content: string; rewrites: number} {
    let rewrites = 0
    const updated = content.replace(WIKILINK_REGEX, (fullMatch: string, raw: string): string => {
        const targetPath = resolveTargetPath(raw, projectRoot, index)
        if (!targetPath) return fullMatch

        const pipeIndex = raw.indexOf('|')
        const labelSuffix = pipeIndex >= 0 ? raw.slice(pipeIndex) : ''
        const want = `${canonicalLinkText(sourceNodeAbsPath, targetPath, projectRoot)}${labelSuffix}`
        if (want === raw) return fullMatch

        rewrites += 1
        return `[[${want}]]`
    })

    return {content: updated, rewrites}
}

export function relinkReferences(projectRoot: string, options: RelinkOptions): ReferenceUpdateSummary {
    const index = buildRelinkDiskIndex(projectRoot, options.mappings)
    const virtualPaths = buildVirtualPathMap(options.mappings ?? [])
    const summary: ReferenceUpdateSummary = {
        filesChanged: [],
        referencesUpdated: 0,
        details: [],
    }

    for (const filePath of index.files) {
        const originalContent = readFileSync(filePath, 'utf8')
        const sourcePathAfterMove = virtualPaths.get(filePath) ?? filePath
        const {content: updatedContent, rewrites} = relinkContent(originalContent, sourcePathAfterMove, projectRoot, index)

        if (updatedContent !== originalContent) {
            const relativePath = relative(projectRoot, filePath)
            summary.filesChanged.push(relativePath)
            summary.referencesUpdated += rewrites
            summary.details.push({file: relativePath, count: rewrites})

            if (!options.dryRun) {
                writeFileSync(filePath, updatedContent, 'utf8')
            }
        }
    }

    return summary
}

function mergeSummaries(left: ReferenceUpdateSummary, right: ReferenceUpdateSummary): ReferenceUpdateSummary {
    const details = new Map<string, number>()
    for (const detail of [...left.details, ...right.details]) {
        details.set(detail.file, (details.get(detail.file) ?? 0) + detail.count)
    }

    return {
        filesChanged: [...new Set([...left.filesChanged, ...right.filesChanged])],
        referencesUpdated: left.referencesUpdated + right.referencesUpdated,
        details: [...details.entries()].map(([file, count]) => ({file, count})),
    }
}

export function mergeReferenceSummaries(left: ReferenceUpdateSummary, right: ReferenceUpdateSummary): ReferenceUpdateSummary {
    return mergeSummaries(left, right)
}

function parseRelinkArgs(args: string[]): {dryRun: boolean; projectRoot: string} {
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

    if (positionals.length > 0) {
        error('Usage: vt graph relink [--dry-run] [--project PATH]')
    }

    return {dryRun, projectRoot}
}

function formatRelinkResult(result: RelinkResult): string {
    const action = result.dryRun ? 'Would rewrite' : 'Rewrote'
    const lines = [`${action} ${result.referencesUpdated} link${result.referencesUpdated === 1 ? '' : 's'} in ${result.filesChanged.length} file${result.filesChanged.length === 1 ? '' : 's'}.`]
    if (result.details.length > 0) {
        lines.push('')
        lines.push('References updated:')
        for (const detail of result.details) {
            lines.push(`  ${detail.file} (${detail.count})`)
        }
    }
    return lines.join('\n')
}

export async function graphRelink(
    _terminalId: string | undefined,
    args: string[]
): Promise<void> {
    const {dryRun, projectRoot} = parseRelinkArgs(args)
    const summary = relinkReferences(projectRoot, {dryRun})
    output({...summary, dryRun}, (data: unknown) => formatRelinkResult(data as RelinkResult))
}
