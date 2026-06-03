/**
 * `vt graph garden <folder> [--apply [--plan FILE]] [--dry-run] [--project PATH]`
 *
 * Suggest (default) prints an editable plan that groups an over-full folder's
 * nodes into cohesive sub-folders (structural communities). Apply moves each
 * group into its sub-folder, writes a folder identity note, and rewrites every
 * reference — reusing the exact `vt graph group` core so behaviour matches.
 *
 * Impure shell: filesystem reads/writes live here; planning is pure (`plan.ts`).
 */

import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {basename, join, relative, resolve} from 'node:path'
import {homedir} from 'node:os'
import {error, output} from '../output'
import {resolveFilePath} from '../move'
import {groupNodesIntoFolder, type GraphGroupResult} from '../group'
import {
    basenameNoExt,
    buildGardenPlan,
    extractWikilinkBasenames,
    firstHeadingTitle,
    formatGardenPlan,
    parseGardenPlan,
    renderFolderNote,
    type GardenFolderNode,
    type GardenPlan,
} from './plan'

const BRAIN = resolve(join(homedir(), 'brain'))
/** Mirrors DEFAULT_SUBGRAPH_ERROR_THRESHOLD: the subgraph gate blocks a connected component at this size. */
const SUBGRAPH_BLOCK_THRESHOLD = 6

interface GardenArgs {
    readonly apply: boolean
    readonly dryRun: boolean
    readonly planFile: string | null
    readonly projectRoot: string
    readonly folderArg: string
}

function parseGardenArgs(args: readonly string[]): GardenArgs {
    let apply = false
    let dryRun = false
    let planFile: string | null = null
    let projectRoot = BRAIN
    const positionals: string[] = []

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (arg === '--apply') {apply = true; continue}
        if (arg === '--dry-run') {dryRun = true; continue}
        if (arg === '--plan') {
            planFile = args[i + 1] ?? error('--plan requires a file path')
            i += 1
            continue
        }
        if (arg === '--project') {
            projectRoot = resolve(args[i + 1] ?? error('--project requires a value'))
            i += 1
            continue
        }
        positionals.push(arg)
    }

    if (positionals.length !== 1) {
        error('Usage: vt graph garden <folder> [--apply [--plan FILE]] [--dry-run] [--project PATH]')
    }
    if (planFile !== null && !apply) {
        error('--plan only applies with --apply')
    }
    return {apply, dryRun, planFile, projectRoot, folderArg: positionals[0]}
}

/** Read the gardened folder's direct-child markdown nodes (excluding its own folder note and context nodes). */
function readFolderNodes(folderAbsPath: string): readonly GardenFolderNode[] {
    const folderName: string = basename(folderAbsPath)
    const identityNote = `${folderName}.md`
    const entries = readdirSync(folderAbsPath, {withFileTypes: true})

    const nodes: GardenFolderNode[] = []
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        if (entry.name === identityNote) continue
        const content: string = readFileSync(join(folderAbsPath, entry.name), 'utf8')
        if (/^isContextNode:\s*true\s*$/m.test(content)) continue
        nodes.push({
            filename: entry.name,
            title: firstHeadingTitle(content, basenameNoExt(entry.name)),
            outgoingBasenames: extractWikilinkBasenames(content),
        })
    }
    return nodes
}

interface ApplyGroup {
    readonly folderName: string
    readonly members: readonly string[]
    readonly representative: string
}

function resolveApplyGroups(plan: GardenPlan, planFile: string | null): readonly ApplyGroup[] {
    if (planFile === null) {
        return plan.clusters.map((c) => ({folderName: c.folderName, members: c.members, representative: c.representative}))
    }
    if (!existsSync(planFile)) error(`Plan file does not exist: ${planFile}`)
    const parsed = parseGardenPlan(readFileSync(planFile, 'utf8'))
    return parsed.map((g) => ({folderName: g.folderName, members: g.members, representative: g.members[0]}))
}

function validateGroups(groups: readonly ApplyGroup[], known: ReadonlySet<string>): void {
    const seen = new Set<string>()
    for (const group of groups) {
        if (group.folderName === '' || /[/\\]/.test(group.folderName)) {
            error(`Invalid sub-folder name: "${group.folderName}"`)
        }
        for (const member of group.members) {
            if (!known.has(member)) error(`Plan references "${member}", which is not a direct node of the folder`)
            if (seen.has(member)) error(`"${member}" is assigned to more than one folder`)
            seen.add(member)
        }
    }
}

interface GardenApplyResult {
    readonly folder: string
    readonly dryRun: boolean
    readonly groups: Array<{folder: string; moved: number; folderNote: string | null}>
    readonly totalMoved: number
    readonly referencesUpdated: number
    readonly remainingTopLevel: number
    readonly largestNewCluster: number
    readonly blockThreshold: number
}

export async function graphGarden(_terminalId: string | undefined, args: string[]): Promise<void> {
    const {apply, dryRun, planFile, projectRoot, folderArg} = parseGardenArgs(args)

    const folderAbsPath: string = resolveFilePath(folderArg, projectRoot)
    if (!existsSync(folderAbsPath) || !statSync(folderAbsPath).isDirectory()) {
        error(`Not a folder: ${folderArg}`)
    }

    const nodes: readonly GardenFolderNode[] = readFolderNodes(folderAbsPath)
    const plan: GardenPlan = buildGardenPlan(nodes)
    const titleOf = new Map<string, string>(nodes.map((n) => [n.filename, n.title]))
    const folderDisplay: string = relative(projectRoot, folderAbsPath) || folderArg

    if (!apply) {
        const planText: string = formatGardenPlan(plan, folderDisplay, titleOf)
        output(
            {
                folder: folderDisplay,
                clusters: plan.clusters,
                leftovers: plan.leftovers,
                planText,
            },
            (data: {planText: string}) => data.planText,
        )
        return
    }

    const groups: readonly ApplyGroup[] = resolveApplyGroups(plan, planFile)
    if (groups.length === 0) {
        error('Nothing to apply: no multi-node communities found. Edit a plan with --plan, or there is nothing to garden.')
    }
    validateGroups(groups, new Set(nodes.map((n) => n.filename)))

    const applied: GardenApplyResult['groups'] = []
    let totalMoved = 0
    let referencesUpdated = 0

    for (const group of groups) {
        const subfolderAbs: string = join(folderAbsPath, group.folderName)
        const sourceAbsPaths: readonly string[] = group.members.map((m) => join(folderAbsPath, m))
        const groupResult: GraphGroupResult = groupNodesIntoFolder(projectRoot, subfolderAbs, sourceAbsPaths, dryRun)

        let folderNoteRel: string | null = null
        const notePath: string = join(subfolderAbs, `${group.folderName}.md`)
        if (!dryRun) {
            const noteMembers = group.members.map((m) => ({filename: m, title: titleOf.get(m) ?? basenameNoExt(m)}))
            writeFileSync(notePath, renderFolderNote(group.folderName, noteMembers, group.representative), 'utf8')
            folderNoteRel = relative(projectRoot, notePath)
        }

        totalMoved += groupResult.movedFiles.length
        referencesUpdated += groupResult.referencesUpdated
        applied.push({folder: relative(projectRoot, subfolderAbs), moved: groupResult.movedFiles.length, folderNote: folderNoteRel})
    }

    const result: GardenApplyResult = {
        folder: folderDisplay,
        dryRun,
        groups: applied,
        totalMoved,
        referencesUpdated,
        remainingTopLevel: nodes.length - totalMoved,
        largestNewCluster: Math.max(...groups.map((g) => g.members.length)),
        blockThreshold: SUBGRAPH_BLOCK_THRESHOLD,
    }
    output(result, formatApplyResult)
}

function formatApplyResult(result: GardenApplyResult): string {
    const verb = result.dryRun ? 'Would garden' : 'Gardened'
    const lines: string[] = [
        `${verb} ${result.folder} → ${result.groups.length} sub-folder${result.groups.length === 1 ? '' : 's'} ` +
            `(${result.totalMoved} node${result.totalMoved === 1 ? '' : 's'} moved, ${result.referencesUpdated} reference${result.referencesUpdated === 1 ? '' : 's'} updated):`,
    ]
    for (const group of result.groups) {
        lines.push(`  ${group.folder}/  (${group.moved} node${group.moved === 1 ? '' : 's'})${group.folderNote ? `  + ${basename(group.folderNote)}` : ''}`)
    }
    lines.push('')
    lines.push(`  ${result.remainingTopLevel} node(s) remain at top level; largest new cluster = ${result.largestNewCluster} (gate blocks a connected component at ${result.blockThreshold}).`)
    if (result.largestNewCluster >= result.blockThreshold) {
        lines.push(`  ⚠ a new cluster is still ≥ ${result.blockThreshold}; re-run garden on it or split it further.`)
    }
    return lines.join('\n')
}
