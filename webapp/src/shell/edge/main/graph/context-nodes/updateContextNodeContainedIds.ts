/**
 * Update a context node's containedNodeIds to mark injected nodes as "seen".
 *
 * Reads the context node markdown file, parses YAML frontmatter,
 * appends new nodeIds to containedNodeIds, and writes back.
 * The file watcher detects the change and propagates a graph delta.
 */

import { promises as fs } from 'fs'
import type { NodeIdAndFilePath } from '@/pure/graph'
import { nodeIdToFilePathWithExtension } from '@/pure/graph/markdown-parsing/filename-utils'

/**
 * Append nodeIds to a context node's containedNodeIds YAML frontmatter.
 *
 * Steps:
 * 1. Read context node markdown file from disk
 * 2. Find the containedNodeIds section in YAML frontmatter
 * 3. Append newly injected nodeIds (deduplicated)
 * 4. Write updated content back to file
 * 5. File watcher detects change -> graph delta propagates -> InjectBar refreshes
 */
export async function updateContextNodeContainedIds(
    contextNodeId: NodeIdAndFilePath,
    newNodeIds: readonly string[]
): Promise<void> {
    const filePath: string = nodeIdToFilePathWithExtension(contextNodeId)

    const fileContent: string = await fs.readFile(filePath, 'utf-8')

    // Split into frontmatter and body
    const frontmatterMatch: RegExpMatchArray | null = fileContent.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
        throw new Error(`Context node ${contextNodeId} has no YAML frontmatter`)
    }

    const frontmatter: string = frontmatterMatch[1]
    const afterFrontmatter: string = fileContent.slice(frontmatterMatch[0].length)

    // Extract existing containedNodeIds
    const existingIds: Set<string> = new Set<string>()
    const containedMatch: RegExpMatchArray | null = frontmatter.match(/containedNodeIds:\n((?:  - .+\n)*)/)
    if (containedMatch) {
        const idLines: string[] = containedMatch[1].split('\n').filter((line: string) => line.trim().startsWith('- '))
        for (const line of idLines) {
            const id: string = line.trim().slice(2) // Remove "- " prefix
            existingIds.add(id)
        }
    }

    // Add new IDs (deduplicate)
    for (const id of newNodeIds) {
        existingIds.add(id)
    }

    // Rebuild containedNodeIds YAML
    const allIds: readonly string[] = Array.from(existingIds)
    const containedNodeIdsYaml: string = allIds.length > 0
        ? `containedNodeIds:\n${allIds.map((id: string) => `  - ${id}`).join('\n')}\n`
        : ''

    // Rebuild frontmatter: replace or insert containedNodeIds section
    let updatedFrontmatter: string
    if (containedMatch) {
        // Replace existing containedNodeIds block
        updatedFrontmatter = frontmatter.replace(
            /containedNodeIds:\n(?:  - .+\n)*/,
            containedNodeIdsYaml
        )
    } else {
        // Append containedNodeIds before the end of frontmatter
        updatedFrontmatter = frontmatter + '\n' + containedNodeIdsYaml
    }

    const updatedContent: string = `---\n${updatedFrontmatter}\n---${afterFrontmatter}`

    await fs.writeFile(filePath, updatedContent, 'utf-8')
}
