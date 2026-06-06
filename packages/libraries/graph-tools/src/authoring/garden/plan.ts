/**
 * Pure planning core for `vt graph garden`.
 *
 * Given the direct-child markdown nodes of an over-full folder, propose a set of
 * sub-folder groupings using structural community detection (Louvain, via
 * {@link partitionIntoCommunities}), then render/parse the human-editable plan
 * text that lets a user tweak which nodes land where. No I/O — the shell
 * (`garden.ts`) reads the folder and applies the result.
 */

import {basename} from 'node:path'
import {
    partitionIntoCommunities,
    type CollapseBoundaryGraph,
    type CollapseBoundaryNode,
    type CollapseCluster,
} from '@vt/graph-tools/view/collapseBoundary/index'

/** A direct-child markdown node of the folder being gardened. */
export interface GardenFolderNode {
    /** Filename relative to the gardened folder, e.g. `"nuke-list.md"`. */
    readonly filename: string
    readonly title: string
    /** Wikilink targets, as basenames without `.md` (case preserved). */
    readonly outgoingBasenames: readonly string[]
}

/** A proposed sub-folder: a cohesive community of nodes. */
export interface GardenCluster {
    /** Slugified folder name, e.g. `"agent-status-reporting-redesign"`. */
    readonly folderName: string
    /** Member filenames (relative to the gardened folder). */
    readonly members: readonly string[]
    readonly cohesion: number
}

export interface GardenPlan {
    readonly clusters: readonly GardenCluster[]
    /** Filenames left at the top level (no community / singleton). */
    readonly leftovers: readonly string[]
}

/** A group parsed back from edited plan text. */
export interface ParsedGroup {
    readonly folderName: string
    readonly members: readonly string[]
}

const KEEP_BLOCK = '_keep_'

export function basenameNoExt(filename: string): string {
    return basename(filename, '.md')
}

export function stripYamlFrontmatter(content: string): string {
    if (!content.startsWith('---\n')) return content
    const end: number = content.indexOf('\n---', 4)
    if (end === -1) return content
    const afterFence: number = content.indexOf('\n', end + 1)
    return afterFence === -1 ? '' : content.slice(afterFence + 1)
}

/** First Markdown `# ` heading, else the first non-empty line, else `fallback`. */
export function firstHeadingTitle(content: string, fallback: string): string {
    const body: string = stripYamlFrontmatter(content)
    const lines: readonly string[] = body.split('\n')
    const heading: string | undefined = lines.find((line) => line.startsWith('# '))
    if (heading) return heading.slice(2).trim()
    const firstNonEmpty: string | undefined = lines.find((line) => line.trim() !== '')
    return firstNonEmpty?.trim() || fallback
}

/** All `[[wikilink]]` targets as basenames (text before any `|`, `.md` stripped). */
export function extractWikilinkBasenames(content: string): readonly string[] {
    const matches: readonly RegExpMatchArray[] = [...content.matchAll(/\[\[([^\]\n\r]+)\]\]/g)]
    return matches
        .map((m) => m[1].split('|')[0].trim())
        .filter((target) => target !== '')
        .map((target) => basenameNoExt(target.split(/[/\\]/).pop() ?? target))
}

/** Folder-name slug from a title: lowercase, non-alphanumeric → `-`, capped at a word boundary. */
export function slugifyTitle(title: string, maxLength = 60): string {
    const slug: string = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    if (slug === '') return 'cluster'
    if (slug.length <= maxLength) return slug
    const truncated: string = slug.slice(0, maxLength)
    const lastDash: number = truncated.lastIndexOf('-')
    return (lastDash > 0 ? truncated.slice(0, lastDash) : truncated).replace(/-+$/g, '')
}

function uniqueName(name: string, used: ReadonlySet<string>): string {
    if (!used.has(name)) return name
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${name}-${suffix}`
        if (!used.has(candidate)) return candidate
    }
}

/**
 * Build a garden plan: cluster the folder's nodes into communities, name each
 * from its representative's title, and leave singletons/uncommunal nodes at the
 * top level. Deterministic for a given input.
 */
export function buildGardenPlan(nodes: readonly GardenFolderNode[]): GardenPlan {
    const idOf = (filename: string): string => basenameNoExt(filename)
    const byLowerId = new Map<string, GardenFolderNode>(nodes.map((n) => [idOf(n.filename).toLowerCase(), n]))

    const boundaryNodes: readonly CollapseBoundaryNode[] = nodes.map((n) => ({
        id: idOf(n.filename),
        title: n.title,
        relPath: n.filename,
        folderPath: '',
        outgoingIds: n.outgoingBasenames
            .map((b) => byLowerId.get(b.toLowerCase()))
            .filter((target): target is GardenFolderNode => target !== undefined)
            .map((target) => idOf(target.filename)),
    }))

    const graph: CollapseBoundaryGraph = {rootName: 'garden', nodes: boundaryNodes}
    const communities: readonly CollapseCluster[] = partitionIntoCommunities(graph)

    const idToFilename = new Map<string, string>(nodes.map((n) => [idOf(n.filename), n.filename]))
    const usedNames = new Set<string>()
    const claimed = new Set<string>()
    const clusters: GardenCluster[] = []

    for (const community of communities) {
        const members: readonly string[] = community.nodeIds
            .map((id) => idToFilename.get(id))
            .filter((filename): filename is string => filename !== undefined)
        if (members.length < 2) continue

        const representative: string = community.representativeRelPath || members[0]
        const seed: string = community.label || basenameNoExt(representative)
        const folderName: string = uniqueName(slugifyTitle(seed), usedNames)
        usedNames.add(folderName)
        members.forEach((m) => claimed.add(m))
        clusters.push({folderName, members, cohesion: community.cohesion})
    }

    const leftovers: readonly string[] = nodes.map((n) => n.filename).filter((f) => !claimed.has(f))
    return {clusters, leftovers}
}

/** Render the editable plan text a user tweaks before `--apply --plan`. */
export function formatGardenPlan(plan: GardenPlan, folderDisplay: string, titleOf: ReadonlyMap<string, string>): string {
    const lines: string[] = [
        `# vt graph garden plan — ${folderDisplay}`,
        '#',
        '# Edit freely, then:  vt graph garden <folder> --apply --plan <this-file>',
        '#   • move a node line under a different [folder] to regroup it',
        '#   • rename a [folder] to rename the sub-folder it creates',
        '#   • delete a [folder] block (or move its lines to [_keep_]) to leave those nodes put',
        '#   • text after "#" on a node line is just the title, ignored on parse',
        '',
    ]

    const memberLine = (filename: string): string => `  ${filename}${titleOf.get(filename) ? `   # ${titleOf.get(filename)}` : ''}`

    for (const cluster of plan.clusters) {
        lines.push(`[${cluster.folderName}]   # suggested · cohesion ${cluster.cohesion.toFixed(2)}`)
        for (const member of cluster.members) lines.push(memberLine(member))
        lines.push('')
    }

    lines.push(`[${KEEP_BLOCK}]   # left at the top level`)
    for (const filename of plan.leftovers) lines.push(memberLine(filename))
    lines.push('')
    return lines.join('\n')
}

/** Parse edited plan text back into groups to apply. The `_keep_` block is dropped. */
export function parseGardenPlan(text: string): readonly ParsedGroup[] {
    const groups: {folderName: string; members: string[]}[] = []
    let current: {folderName: string; members: string[]} | null = null
    let inKeepBlock = false

    for (const rawLine of text.split('\n')) {
        const line: string = rawLine.trim()
        if (line === '' || line.startsWith('#')) continue

        const header: RegExpMatchArray | null = line.match(/^\[(.+?)\]/)
        if (header) {
            const folderName: string = header[1].trim()
            if (folderName.toLowerCase() === KEEP_BLOCK) {
                current = null
                inKeepBlock = true
                continue
            }
            current = {folderName, members: []}
            inKeepBlock = false
            groups.push(current)
            continue
        }

        const member: string = line.split('#')[0].trim()
        if (member === '') continue
        if (inKeepBlock) continue
        if (current === null) {
            throw new Error(`Node line "${member}" is not under any [folder] header`)
        }
        current.members.push(member)
    }

    return groups.filter((group) => group.members.length > 0)
}

/**
 * Render a folder identity note (`<folder>/<folder>.md`), capped near 15 body lines.
 *
 * `parentBasename` is the basename (no extension) of the node the new folder hangs
 * off in the graph — the gardened folder's own identity note. It must NOT be one of
 * the `members` (those are moved INTO this folder); parenting to a member would make
 * the folder note a child of its own contents.
 */
export function renderFolderNote(
    folderName: string,
    members: readonly {filename: string; title: string}[],
    parentBasename: string,
): string {
    const MAX_LISTED = 8
    const listed: readonly {filename: string; title: string}[] = members.slice(0, MAX_LISTED)
    const overflow: number = members.length - listed.length

    const contents: string[] = listed.map(
        ({filename, title}) => `- **${basenameNoExt(filename)}** — ${title}`,
    )
    if (overflow > 0) contents.push(`- …and ${overflow} more`)

    return [
        '---',
        'color: green',
        'isContextNode: false',
        '---',
        `# ${folderName}`,
        '',
        '<!-- Auto-generated by `vt graph garden`; refine this summary. -->',
        '',
        '## Contents',
        ...contents,
        '',
        `- parent [[${parentBasename}]]`,
        '',
    ].join('\n')
}
