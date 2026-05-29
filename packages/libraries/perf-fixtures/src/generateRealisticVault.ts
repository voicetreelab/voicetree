/**
 * Deterministic vault generator for perf harnesses.
 *
 * Writes N markdown files into a target directory arranged into clusters,
 * topic folders, and isolated nodes, with wikilinks between them. The result
 * is a "realistic" vault that the daemon's chokidar+loader path can ingest
 * the same way it would a user's vault — far more useful than `mkdtemp`'s
 * empty dir for perf tests that need real parent nodes to attach to.
 *
 * This file is the single source of truth, consumed by:
 *   - `packages/measures/perf/agent-storm.ts`  (daemon-only storm harness)
 *   - `packages/measures/perf/e2e-storm-mvp/index.ts` (headful electron + fake-agent MVP)
 *   - `webapp/e2e-tests/.../electron-500-node-realistic-perf.spec.ts` (LOAD/PAN-ZOOM/UPDATE)
 *
 * Pure data + sync fs writes. No async, no logging, no console output —
 * those would couple this to a particular runtime / test framework.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'

export interface VaultNode {
    readonly relativePath: string
    readonly content: string
}

export interface VaultLayout {
    readonly nodes: readonly VaultNode[]
    readonly firstClusterNodePaths: readonly string[]
}

const PHRASES: readonly string[] = [
    'Working through the implementation details.',
    'Need to review the edge cases here.',
    'This connects to the broader architecture discussion.',
    'Performance considerations are important for this section.',
    'Iterating on the design based on feedback.',
    'The constraint solver needs careful tuning.',
    'Layout algorithm handles this via cola.js.',
    'File watcher integration is the critical path.',
]

function generateParagraph(idx: number): string {
    return PHRASES[idx % PHRASES.length]
}

function buildNodeContent(id: string, idx: number, links: readonly string[], description: string): string {
    const frontmatter = ['---', 'isContextNode: false', '---'].join('\n')
    const body: string[] = [
        `# ${description}`,
        '',
        `This is ${id}. ${generateParagraph(idx)}`,
        '',
    ]
    if (links.length > 0) {
        body.push('-----------------')
        body.push('_Links:_')
        body.push('')
        for (const link of links) body.push(link)
    }
    return `${frontmatter}\n${body.join('\n')}\n`
}

/**
 * Compute the in-memory layout of an N-node realistic vault.
 *
 * Returned `nodes[]` is in deterministic order. `firstClusterNodePaths[]` is
 * the per-cluster first node's relative path; perf harnesses use these as
 * distinct parent-node hooks to avoid all agents dogpiling on one parent.
 */
export function planVault(nodeCount: number): VaultLayout {
    const nodes: VaultNode[] = []
    const firstClusterNodePaths: string[] = []

    const clusterCount = 8
    const nodesPerCluster = Math.min(50, Math.floor(nodeCount / 16) + 1)
    const folderCount = 5
    const nodesPerFolder = Math.min(15, Math.floor(nodeCount / 50) + 1)
    const clustered = clusterCount * nodesPerCluster
    const foldered = folderCount * nodesPerFolder
    const isolatedCount = Math.max(0, nodeCount - clustered - foldered)

    let nodeIdx = 0
    for (let c = 0; c < clusterCount; c++) {
        const clusterDir = `cluster-${String.fromCharCode(97 + c)}`
        const subDirs = [`${clusterDir}/planning`, `${clusterDir}/implementation`, `${clusterDir}/review`]
        for (let i = 0; i < nodesPerCluster; i++) {
            const id = `node-${nodeIdx}`
            const dir = i < 15 ? subDirs[0] : i < 35 ? subDirs[1] : subDirs[2]
            const links: string[] = []
            if (i > 0) links.push(`[[node-${nodeIdx - 1}.md]]`)
            if (i > 5) links.push(`[[node-${nodeIdx - 5}.md]]`)
            if (i === 0 && c > 0) links.push(`[[node-${(c - 1) * nodesPerCluster}.md]]`)
            const relPath = `${dir}/${id}.md`
            nodes.push({
                relativePath: relPath,
                content: buildNodeContent(id, nodeIdx, links, `Cluster ${String.fromCharCode(65 + c)} task ${i}`),
            })
            if (i === 0) firstClusterNodePaths.push(relPath)
            nodeIdx++
        }
    }
    for (let f = 0; f < folderCount; f++) {
        const folderDir = `topics/topic-${f}`
        for (let i = 0; i < nodesPerFolder; i++) {
            const id = `node-${nodeIdx}`
            const links: string[] = []
            if (i > 0) links.push(`[[node-${nodeIdx - 1}.md]]`)
            nodes.push({
                relativePath: `${folderDir}/${id}.md`,
                content: buildNodeContent(id, nodeIdx, links, `Topic ${f} note ${i}`),
            })
            nodeIdx++
        }
    }
    for (let i = 0; i < isolatedCount; i++) {
        const id = `node-${nodeIdx}`
        const links: string[] = []
        if (i % 3 === 0 && nodeIdx > 50) links.push(`[[node-${nodeIdx - 50}.md]]`)
        nodes.push({
            relativePath: `${id}.md`,
            content: buildNodeContent(id, nodeIdx, links, `Standalone note ${i}`),
        })
        nodeIdx++
    }

    return { nodes, firstClusterNodePaths }
}

/**
 * Write a realistic vault rooted at `vaultPath`.
 *
 * Creates `vaultPath`, `vaultPath/.voicetree/positions.json`,
 * `vaultPath/ctx-nodes/`, and one .md file per node. Caller owns `vaultPath`
 * lifecycle and cleanup.
 */
export function generateVaultOnDisk(vaultPath: string, nodeCount: number): VaultLayout {
    mkdirSync(vaultPath, { recursive: true })
    const voicetreeDir = getProjectDotVoicetreePath(vaultPath)
    mkdirSync(voicetreeDir, { recursive: true })
    writeFileSync(join(voicetreeDir, 'positions.json'), '{}', 'utf8')
    mkdirSync(join(vaultPath, 'ctx-nodes'), { recursive: true })

    const plan = planVault(nodeCount)
    const createdDirs = new Set<string>()
    for (const node of plan.nodes) {
        const fullPath = join(vaultPath, node.relativePath)
        const dir = dirname(fullPath)
        if (!createdDirs.has(dir)) {
            mkdirSync(dir, { recursive: true })
            createdDirs.add(dir)
        }
        writeFileSync(fullPath, node.content, 'utf8')
    }
    return plan
}
