import { describe, it, expect } from 'vitest'
import type { Graph } from '@vt/graph-model/graph'
import { buildGraphFromFiles, getSubgraphByDistance } from '@vt/graph-model/graph'
import {
    maxPreviewLinesForHops,
    generateNodeDetailsList,
} from './createContextNode'

// =================================================================
// Behavioral contract of the hop-decay formula.
// Asserts shape, not exact numbers — the test is independent of
// whatever sigmoid (or any other curve) we pick.
// =================================================================

describe('maxPreviewLinesForHops — behavioral contract', () => {
    it('is monotone non-increasing as hops grow', () => {
        for (let h: number = 1; h < 50; h++) {
            expect(maxPreviewLinesForHops(h + 1)).toBeLessThanOrEqual(maxPreviewLinesForHops(h))
        }
    })

    it('floor is exactly 15 lines (never below)', () => {
        // At very large distance the curve must converge to the floor.
        expect(maxPreviewLinesForHops(10_000)).toBe(15)
        for (let h: number = 0; h <= 200; h++) {
            expect(maxPreviewLinesForHops(h)).toBeGreaterThanOrEqual(15)
        }
    })

    it('gives a "lots of context" tier (>=350 lines) at hop 1', () => {
        expect(maxPreviewLinesForHops(1)).toBeGreaterThanOrEqual(350)
    })

    it('stays in the "lots of context" tier through ~3 hops', () => {
        // Allowing some slack: by hop 3 we still want plenty of content.
        expect(maxPreviewLinesForHops(3)).toBeGreaterThanOrEqual(300)
    })

    it('has actually decayed substantially by hop 10', () => {
        // Whatever the curve looks like, far neighbors must be much smaller than near ones.
        const near: number = maxPreviewLinesForHops(1)
        const far: number = maxPreviewLinesForHops(10)
        expect(far).toBeLessThan(near / 3)
    })

    it('treats non-finite or non-positive hops as floor', () => {
        expect(maxPreviewLinesForHops(Number.POSITIVE_INFINITY)).toBe(15)
        expect(maxPreviewLinesForHops(0)).toBe(15)
        expect(maxPreviewLinesForHops(-1)).toBe(15)
    })
})

// =================================================================
// Integration: end-to-end behavior of generateNodeDetailsList over
// a real Graph built from in-memory markdown files. Uses a long
// linear chain so we can compare hop=1 vs hop=large in one output.
// =================================================================

function makeChainGraph(depth: number, linesPerNode: number): Graph {
    const files: { absolutePath: string; content: string }[] = []
    for (let i: number = 0; i < depth; i++) {
        const body: string = Array.from(
            { length: linesPerNode },
            (_: unknown, j: number) => `chain ${i} payload line ${j}`,
        ).join('\n')
        const next: string = i + 1 < depth ? `\n\n[[node${i + 1}]]` : ''
        files.push({
            absolutePath: `node${i}.md`,
            content: `# node ${i}\n\n${body}${next}`,
        })
    }
    return buildGraphFromFiles(files)
}

function omittedLinesFor(output: string, nodeId: string): number | null {
    // Each neighbor block ends with `  ...N additional lines` if anything was truncated.
    // Find the block that mentions this nodeId and read the omitted count.
    const re: RegExp = new RegExp(
        // - **title** (nodeId)\n  ...preview...\n  ...N additional lines
        String.raw`\(${nodeId}\)[\s\S]*?\.\.\.(\d+) additional lines`,
    )
    const m: RegExpExecArray | null = re.exec(output)
    return m ? parseInt(m[1], 10) : null
}

describe('generateNodeDetailsList — hop decay on a real graph', () => {
    it('a wider distance budget yields a larger subgraph', () => {
        // Sanity check on the fixture: budget 10 reaches more of the chain than budget 5.
        const graph: Graph = makeChainGraph(40, 600)
        const small: Graph = getSubgraphByDistance(graph, 'node0.md', 5)
        const large: Graph = getSubgraphByDistance(graph, 'node0.md', 10)
        expect(Object.keys(large.nodes).length).toBeGreaterThan(
            Object.keys(small.nodes).length,
        )
    })

    it('closer neighbors are previewed more richly than farther ones', () => {
        const graph: Graph = makeChainGraph(40, 600)
        // Large budget so the line cap doesn't excise nodes from the list.
        const subgraph: Graph = getSubgraphByDistance(graph, 'node0.md', 20)
        const output: string = generateNodeDetailsList(
            subgraph,
            'node0.md',
            [],
            10_000_000,
        )

        const near: number | null = omittedLinesFor(output, 'node1.md')
        const mid: number | null = omittedLinesFor(output, 'node5.md')
        const far: number | null = omittedLinesFor(output, 'node10.md')

        expect(near).not.toBeNull()
        expect(mid).not.toBeNull()
        expect(far).not.toBeNull()
        // Fewer omitted lines = richer preview. Closer wins.
        expect(near!).toBeLessThan(mid!)
        expect(mid!).toBeLessThan(far!)
    })

    it('far neighbors at slider=10 (distance≈58 hops) bottom out at the floor', () => {
        // slider square 10 with the 1.5^N mapping is distance budget ≈ 58.
        // At that radius the chain is 38 nodes deep — well past the floor onset.
        const graph: Graph = makeChainGraph(45, 600)
        const subgraph: Graph = getSubgraphByDistance(graph, 'node0.md', 58)
        const output: string = generateNodeDetailsList(
            subgraph,
            'node0.md',
            [],
            10_000_000,
        )

        // A deep neighbor should be previewing only the floor (15 lines)
        // of its ~600-line body, so omitted ≈ 585.
        const deepOmitted: number | null = omittedLinesFor(output, 'node30.md')
        expect(deepOmitted).not.toBeNull()
        // Floor is 15 lines visible. Allow tiny slack for the curve approaching floor.
        expect(deepOmitted!).toBeGreaterThanOrEqual(580)
    })

    it('near neighbor at slider=5 (distance≈8 hops) gets a large preview', () => {
        const graph: Graph = makeChainGraph(40, 600)
        const subgraph: Graph = getSubgraphByDistance(graph, 'node0.md', 8)
        const output: string = generateNodeDetailsList(
            subgraph,
            'node0.md',
            [],
            10_000_000,
        )

        // node1.md is one hop away; should be near the ceiling.
        const nearOmitted: number | null = omittedLinesFor(output, 'node1.md')
        expect(nearOmitted).not.toBeNull()
        // hop=1 gets ≥350 visible lines → omitted ≤ 600 - 350 = 250.
        expect(nearOmitted!).toBeLessThanOrEqual(250)
    })
})
