#!/usr/bin/env node --import tsx

import * as fs from 'node:fs'
import * as path from 'node:path'

type SyntheticKind = 'tree' | 'cycle' | 'clique'

type SyntheticFixtureSpec = {
    readonly name: string
    readonly titlePrefix: string
    readonly description: string
    readonly kind: SyntheticKind
    readonly nodeCount: number
    readonly coreSize?: number
}

type GeneratedFixture = {
    readonly name: string
    readonly root: string
    readonly description: string
    readonly expectedArboricity: number
}

type NodeSpec = {
    readonly index: number
    readonly relPath: string
    readonly title: string
    readonly outgoing: number[]
}

const DEFAULT_FIXTURES_ROOT = '/tmp/bf193-fixtures'
const DEFAULT_SEED = 193

const SYNTHETIC_FIXTURE_SPECS: readonly SyntheticFixtureSpec[] = [
    {
        name: 'synthetic-a1-tree',
        titlePrefix: 'Synthetic A1 Tree',
        description: 'A pure spanning-tree wikilink graph with no undirected cycles.',
        kind: 'tree',
        nodeCount: 24,
    },
    {
        name: 'synthetic-a2-cycle',
        titlePrefix: 'Synthetic A2 Cycle',
        description: 'A single core cycle with tree attachments, forcing arboricity 2.',
        kind: 'cycle',
        nodeCount: 30,
        coreSize: 18,
    },
    {
        name: 'synthetic-k5-core',
        titlePrefix: 'Synthetic K5 Core',
        description: 'A K5 clique core plus trees. Exact clique arboricity is 3; the sweep records BF-192\'s greedy upper bound.',
        kind: 'clique',
        nodeCount: 36,
        coreSize: 5,
    },
    {
        name: 'synthetic-k9-core',
        titlePrefix: 'Synthetic K9 Core',
        description: 'A K9 clique core plus trees. Exact clique arboricity is 5; the sweep records BF-192\'s greedy upper bound.',
        kind: 'clique',
        nodeCount: 42,
        coreSize: 9,
    },
    {
        name: 'synthetic-k15-core',
        titlePrefix: 'Synthetic K15 Core',
        description: 'A K15 clique core plus trees. Exact clique arboricity is 8; the sweep records BF-192\'s greedy upper bound.',
        kind: 'clique',
        nodeCount: 52,
        coreSize: 15,
    },
]

function mulberry32(seed: number): () => number {
    let state: number = seed >>> 0
    return (): number => {
        state += 0x6D2B79F5
        let t: number = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
    const copy: T[] = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
        const j: number = Math.floor(rand() * (i + 1))
        const tmp: T = copy[i]!
        copy[i] = copy[j]!
        copy[j] = tmp
    }
    return copy
}

function expectedArboricity(spec: SyntheticFixtureSpec): number {
    if (spec.kind === 'tree') return 1
    if (spec.kind === 'cycle') return 2
    return Math.ceil((spec.coreSize ?? 1) / 2)
}

function buildLeafFolders(rand: () => number): readonly string[] {
    return shuffle([
        'cluster-a/alpha',
        'cluster-a/beta',
        'cluster-b/alpha',
        'cluster-b/beta',
        'cluster-c/alpha',
        'cluster-c/beta',
    ], rand)
}

function pad(value: number): string {
    return String(value).padStart(3, '0')
}

function linkTarget(relPath: string): string {
    return relPath.replace(/\.md$/u, '')
}

function addTreeEdges(nodes: NodeSpec[]): void {
    for (let index = 1; index < nodes.length; index++) {
        const parent: number = Math.floor((index - 1) / 2)
        nodes[parent]!.outgoing.push(index)
    }
}

function addCycleEdges(nodes: NodeSpec[], cycleSize: number): void {
    for (let index = 0; index < cycleSize; index++) {
        nodes[index]!.outgoing.push((index + 1) % cycleSize)
    }
    for (let index = cycleSize; index < nodes.length; index++) {
        const parent: number = (index - cycleSize) % cycleSize
        nodes[parent]!.outgoing.push(index)
    }
}

function addCliqueEdges(nodes: NodeSpec[], coreSize: number, rand: () => number): void {
    for (let left = 0; left < coreSize; left++) {
        for (let right = left + 1; right < coreSize; right++) {
            nodes[left]!.outgoing.push(right)
        }
    }
    for (let index = coreSize; index < nodes.length; index++) {
        const parent: number = Math.floor(rand() * index)
        nodes[parent]!.outgoing.push(index)
    }
}

function buildNodes(spec: SyntheticFixtureSpec, seed: number): NodeSpec[] {
    const rand: () => number = mulberry32(seed)
    const folders: readonly string[] = buildLeafFolders(rand)
    const nodes: NodeSpec[] = Array.from({length: spec.nodeCount}, (_, index) => {
        const folder: string = folders[index % folders.length]!
        const basename: string = `${spec.name}-node-${pad(index + 1)}`
        return {
            index,
            relPath: `${folder}/${basename}.md`,
            title: `${spec.titlePrefix} Node ${pad(index + 1)}`,
            outgoing: [],
        }
    })

    if (spec.kind === 'tree') addTreeEdges(nodes)
    else if (spec.kind === 'cycle') addCycleEdges(nodes, spec.coreSize ?? Math.max(3, Math.floor(spec.nodeCount * 0.6)))
    else addCliqueEdges(nodes, spec.coreSize ?? 5, rand)

    return nodes
}

function renderNodeMarkdown(
    spec: SyntheticFixtureSpec,
    node: NodeSpec,
    allNodes: readonly NodeSpec[],
    seed: number,
): string {
    const linkLines: string[] = node.outgoing.length > 0
        ? node.outgoing.map(target => `- [[${linkTarget(allNodes[target]!.relPath)}]]`)
        : ['- none']

    return [
        '---',
        `fixture: ${spec.name}`,
        `seed: ${seed}`,
        `node_index: ${node.index + 1}`,
        '---',
        `# ${node.title}`,
        '',
        spec.description,
        '',
        `Expected arboricity: ${expectedArboricity(spec)}.`,
        '',
        '## Links',
        ...linkLines,
        '',
    ].join('\n')
}

function writeFixture(root: string, spec: SyntheticFixtureSpec, seed: number): GeneratedFixture {
    fs.rmSync(root, {recursive: true, force: true})
    const nodes: NodeSpec[] = buildNodes(spec, seed)

    for (const node of nodes) {
        const absPath: string = path.join(root, node.relPath)
        fs.mkdirSync(path.dirname(absPath), {recursive: true})
        fs.writeFileSync(absPath, renderNodeMarkdown(spec, node, nodes, seed), 'utf8')
    }

    return {
        name: spec.name,
        root,
        description: spec.description,
        expectedArboricity: expectedArboricity(spec),
    }
}

function ensureSyntheticFixtures(
    fixturesRoot: string = DEFAULT_FIXTURES_ROOT,
    baseSeed: number = DEFAULT_SEED,
): readonly GeneratedFixture[] {
    fs.mkdirSync(fixturesRoot, {recursive: true})
    const fixtures: GeneratedFixture[] = SYNTHETIC_FIXTURE_SPECS.map((spec, index) =>
        writeFixture(path.join(fixturesRoot, spec.name), spec, baseSeed + index),
    )
    fs.writeFileSync(
        path.join(fixturesRoot, 'manifest.json'),
        JSON.stringify({baseSeed, fixtures}, null, 2),
        'utf8',
    )
    return fixtures
}

function main(): void {
    let fixturesRoot: string = DEFAULT_FIXTURES_ROOT
    let seed: number = DEFAULT_SEED

    for (let index = 2; index < process.argv.length; index++) {
        const arg: string = process.argv[index]!
        if (arg === '--root') {
            fixturesRoot = path.resolve(process.argv[++index] ?? fixturesRoot)
            continue
        }
        if (arg === '--seed') {
            seed = Number(process.argv[++index] ?? seed)
            continue
        }
    }

    const fixtures: readonly GeneratedFixture[] = ensureSyntheticFixtures(fixturesRoot, seed)
    console.log(`Generated ${fixtures.length} BF-193 fixtures in ${fixturesRoot}`)
    for (const fixture of fixtures) {
        console.log(`- ${fixture.name}: a(G)=${fixture.expectedArboricity} @ ${fixture.root}`)
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export {
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_SEED,
    SYNTHETIC_FIXTURE_SPECS,
    ensureSyntheticFixtures,
}
export type {GeneratedFixture, SyntheticFixtureSpec}
