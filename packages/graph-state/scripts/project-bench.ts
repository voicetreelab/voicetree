import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { performance } from 'perf_hooks'

import * as O from 'fp-ts/lib/Option.js'

import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'

import type { State } from '../src/contract'
import { toFixtureJson } from '../src/fixtures'
import { project } from '../src/project'

const ROOT_PATH = '/tmp/graph-state-bench/root'
const FOLDER_COUNT = 5
const NODE_COUNT = 1000
const EDGES_PER_NODE = 3
const WARMUP_ITERATIONS = 50
const MEASURED_ITERATIONS = 500
const MEAN_THRESHOLD_MS = 50
const P95_THRESHOLD_MS = 3.5 // baseline p95 = 2.965 ms; 3.5 gives 18% headroom on a quiet machine
const BASELINE_PATH = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'bench',
    'project-baseline.json',
)

function folderPath(index: number): string {
    return `${ROOT_PATH}/folder-${index}`
}

function nodePath(index: number): string {
    const filesPerFolder = NODE_COUNT / FOLDER_COUNT
    const folderIndex = Math.floor(index / filesPerFolder)
    return `${folderPath(folderIndex)}/node-${String(index).padStart(4, '0')}.md`
}

function createNode(nodeId: string, targets: readonly string[]): GraphNode {
    return {
        outgoingEdges: targets.map((targetId, index) => ({
            targetId,
            label: ['links', 'depends-on', 'references'][index] ?? 'links',
        })),
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: `# ${path.posix.basename(nodeId, '.md')}\n\nSynthetic bench node.\n`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
        },
    }
}

function buildGraph(): Graph {
    const nodeIds = Array.from({ length: NODE_COUNT }, (_, index) => nodePath(index))
    const incomingEdgesIndex = new Map<string, string[]>()
    const nodeByBaseName = new Map<string, string[]>()

    const nodes = Object.fromEntries(
        nodeIds.map((nodeId, index) => {
            const targets = [
                nodeIds[(index + 1) % NODE_COUNT],
                nodeIds[(index + 37) % NODE_COUNT],
                nodeIds[(index + 211) % NODE_COUNT],
            ]

            for (const targetId of targets) {
                const incoming = incomingEdgesIndex.get(targetId) ?? []
                incoming.push(nodeId)
                incomingEdgesIndex.set(targetId, incoming)
            }

            const basename = path.posix.basename(nodeId, '.md').toLowerCase()
            const aliases = nodeByBaseName.get(basename) ?? []
            aliases.push(nodeId)
            nodeByBaseName.set(basename, aliases)

            return [nodeId, createNode(nodeId, targets)]
        }),
    )

    return {
        nodes,
        incomingEdgesIndex: new Map(
            [...incomingEdgesIndex.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([targetId, sourceIds]) => [targetId, sourceIds.sort((left, right) => left.localeCompare(right))] as const),
        ),
        nodeByBaseName: new Map(
            [...nodeByBaseName.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([basename, ids]) => [basename, ids.sort((left, right) => left.localeCompare(right))] as const),
        ),
        unresolvedLinksIndex: new Map(),
    }
}

function buildFolderTree(): readonly FolderTreeNode[] {
    const filesPerFolder = NODE_COUNT / FOLDER_COUNT

    return [
        {
            name: 'root',
            absolutePath: ROOT_PATH as FolderTreeNode['absolutePath'],
            loadState: 'loaded',
            isWriteTarget: true,
            children: Array.from({ length: FOLDER_COUNT }, (_, folderIndex) => ({
                name: `folder-${folderIndex}`,
                absolutePath: folderPath(folderIndex) as FolderTreeNode['absolutePath'],
                loadState: 'not-loaded' as const,
                isWriteTarget: false,
                children: Array.from({ length: filesPerFolder }, (_, innerIndex) => {
                    const nodeIndex = folderIndex * filesPerFolder + innerIndex
                    return {
                        name: `node-${String(nodeIndex).padStart(4, '0')}.md`,
                        absolutePath: nodePath(nodeIndex) as FolderTreeNode['children'][number]['absolutePath'],
                        isInGraph: true,
                    }
                }),
            })),
        },
    ]
}

function buildState(): State {
    const filesPerFolder = NODE_COUNT / FOLDER_COUNT

    return {
        graph: buildGraph(),
        roots: {
            loaded: new Set([ROOT_PATH]),
            folderTree: buildFolderTree(),
        },
        collapseSet: new Set(
            Array.from({ length: FOLDER_COUNT }, (_, folderIndex) => folderIndex)
                .filter((folderIndex) => folderIndex < Math.ceil(FOLDER_COUNT / 2))
                .map((folderIndex) => `${folderPath(folderIndex)}/`),
        ),
        selection: new Set(
            Array.from({ length: filesPerFolder / 10 }, (_, index) => nodePath(index * 3)),
        ),
        layout: {
            positions: new Map(
                Array.from({ length: NODE_COUNT }, (_, index) => {
                    const row = Math.floor(index / 25)
                    const column = index % 25
                    return [nodePath(index), { x: column * 80, y: row * 80 }] as const
                }),
            ),
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
        },
    }
}

function percentile(values: readonly number[], proportion: number): number {
    const sorted = [...values].sort((left, right) => left - right)
    const index = Math.max(0, Math.ceil(sorted.length * proportion) - 1)
    return sorted[index]
}

function roundMetric(value: number): number {
    return Number(value.toFixed(3))
}

async function maybeWriteBaseline(meanMs: number, p95Ms: number): Promise<void> {
    if (!process.argv.includes('--write-baseline')) {
        return
    }

    const payload = {
        version: 1,
        nodes: NODE_COUNT,
        edges: NODE_COUNT * EDGES_PER_NODE,
        meanMs: roundMetric(meanMs),
        p95Ms: roundMetric(p95Ms),
        machine: `${os.platform()} ${os.release()} ${os.arch()}`,
    }

    await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true })
    await fs.writeFile(BASELINE_PATH, toFixtureJson(payload), 'utf8')
}

async function main(): Promise<void> {
    const state = buildState()
    const durations: number[] = []

    for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
        project(state)
    }

    for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration += 1) {
        const startedAt = performance.now()
        project(state)
        durations.push(performance.now() - startedAt)
    }

    const meanMs = durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    const p95Ms = percentile(durations, 0.95)

    await maybeWriteBaseline(meanMs, p95Ms)

    const stddevMs = Math.sqrt(durations.reduce((sum, d) => sum + (d - meanMs) ** 2, 0) / durations.length)
    const p99Ms = percentile(durations, 0.99)

    console.log(`mean=${meanMs.toFixed(3)} ms p50=${percentile(durations, 0.5).toFixed(3)} ms p95=${p95Ms.toFixed(3)} ms p99=${p99Ms.toFixed(3)} ms stddev=${stddevMs.toFixed(3)} ms`)

    if (meanMs >= MEAN_THRESHOLD_MS) {
        process.exitCode = 1
    }

    if (p95Ms >= P95_THRESHOLD_MS) {
        console.error(`FAIL: p95 ${p95Ms.toFixed(3)} ms >= ${P95_THRESHOLD_MS} ms gate (re-run on a quiet machine before treating as a real regression)`)
        process.exitCode = 1
    }
}

void main()
