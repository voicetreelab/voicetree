import { readdirSync, statSync } from 'fs'
import path from 'path'

export type StructureNode = {
    id: string
    title: string
    outgoingIds: string[]
}

export function scanMarkdownFiles(dirPath: string): readonly string[] {
    const results: string[] = []

    function walk(dir: string): void {
        const entries: string[] = readdirSync(dir).sort((left, right) => left.localeCompare(right))
        for (const entry of entries) {
            if (entry === 'ctx-nodes') continue
            if (entry.startsWith('.')) continue

            const fullPath: string = path.join(dir, entry)
            const stat: ReturnType<typeof statSync> = statSync(fullPath)
            if (stat.isDirectory()) {
                walk(fullPath)
            } else if (entry.endsWith('.md')) {
                results.push(fullPath)
            }
        }
    }

    walk(dirPath)
    return results
}

export function getNodeId(rootPath: string, absolutePath: string): string {
    const relativePath: string = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
    return relativePath.replace(/\.md$/i, '')
}

export function deriveTitle(content: string, absolutePath: string): string {
    const contentWithoutFrontmatter: string = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const headingMatch: RegExpMatchArray | null = contentWithoutFrontmatter.match(/^#\s+(.+)$/m)
    if (headingMatch?.[1]) {
        return headingMatch[1].trim()
    }

    const firstNonEmptyLine: string | undefined = contentWithoutFrontmatter
        .split('\n')
        .map(line => line.trim())
        .find(line => line.length > 0)

    if (firstNonEmptyLine) {
        return firstNonEmptyLine
    }

    return path.basename(absolutePath, '.md')
}

export function extractLinks(content: string): string[] {
    const links: string[] = []
    const wikilinkRegex: RegExp = /\[\[([^[\]]+)\]\]/g

    for (const match of content.matchAll(wikilinkRegex)) {
        const rawLink: string | undefined = match[1]
        if (rawLink) {
            links.push(rawLink)
        }
    }

    return links
}

export function buildUniqueBasenameMap(nodesById: ReadonlyMap<string, StructureNode>): Map<string, string> {
    const idsByBasename: Map<string, string[]> = new Map()

    for (const nodeId of nodesById.keys()) {
        const basename: string = path.posix.basename(nodeId)
        const ids: string[] = idsByBasename.get(basename) ?? []
        ids.push(nodeId)
        idsByBasename.set(basename, ids)
    }

    const uniqueBasenames: Map<string, string> = new Map()
    for (const [basename, ids] of idsByBasename.entries()) {
        if (ids.length === 1) {
            uniqueBasenames.set(basename, ids[0])
        }
    }

    return uniqueBasenames
}

export function resolveLinkTarget(
    rawLink: string,
    currentId: string,
    nodesById: ReadonlyMap<string, StructureNode>,
    uniqueBasenames: ReadonlyMap<string, string>
): string | undefined {
    const linkTarget: string = rawLink.split('|')[0]?.split('#')[0]?.trim() ?? ''
    if (!linkTarget) {
        return undefined
    }

    const normalizedTarget: string = linkTarget.replace(/\\/g, '/').replace(/\.md$/i, '')
    const currentDir: string = path.posix.dirname(currentId)
    const exactCandidates: string[] = [
        path.posix.normalize(normalizedTarget),
        path.posix.normalize(path.posix.join(currentDir, normalizedTarget)),
    ]

    for (const candidate of exactCandidates) {
        if (nodesById.has(candidate)) {
            return candidate
        }
    }

    return uniqueBasenames.get(path.posix.basename(normalizedTarget))
}
