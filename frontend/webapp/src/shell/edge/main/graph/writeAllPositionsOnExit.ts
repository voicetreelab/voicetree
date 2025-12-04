import type { Graph, FilePath } from '@/pure/graph'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import { nodeIdToFilePathWithExtension } from '@/pure/graph/markdown-parsing/filename-utils'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Synchronously write all nodes to disk on app exit.
 * This persists in-memory position changes to YAML frontmatter.
 *
 * NOTE: This may trigger file watcher events during shutdown.
 * Currently ignored since the app is exiting anyway - the watcher
 * should be torn down shortly after. If this causes issues,
 * consider pausing the watcher before calling this function.
 */
export function writeAllPositionsSync(graph: Graph, vaultPath: FilePath): void {
    const nodes: readonly import('@/pure/graph').GraphNode[] = Object.values(graph.nodes)
    console.log('Writing node pos on close');
    for (const node of nodes) {
        const markdown: string = fromNodeToMarkdownContent(node)
        const filename: string = nodeIdToFilePathWithExtension(node.relativeFilePathIsID)
        const fullPath: string = path.join(vaultPath, filename)

        // Ensure parent directory exists
        const dir: string = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
            console.error("DIR DOESNT EXIST< SOMETHING IS WRONG")
            // fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(fullPath, markdown, 'utf-8')
    }
}
