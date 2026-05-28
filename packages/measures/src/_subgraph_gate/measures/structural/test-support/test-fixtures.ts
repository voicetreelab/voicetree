/**
 * Test fixtures for synthetic ParsedSubgraph construction.
 *
 * The seven structural measures take a {@link ParsedSubgraph} as input.
 * Building a real one requires filesystem reads via {@link parseSubgraph},
 * which is overkill for unit-level fixtures. This helper builds one in
 * memory so each measure test can express its BAD/GOOD case as a tiny
 * (community → files, file → imports) shape.
 *
 * Communities are encoded directly in the file path: a file at
 * `${pkg}/${subdir}/${name}.ts` lands in community `${pkg}/${subdir}` at
 * depth 1, matching {@link communityAtDepth}. This keeps fixtures honest:
 * the same community-assignment code paths run for fixtures and real code.
 */
import type {Project} from 'ts-morph'
import type {Edge, SourceFile} from '../../../../_shared/graph/import-graph.ts'
import type {ParsedSubgraph} from '../../../../_shared/graph/parse-subgraph.ts'
import {communityAtDepth} from '../../../../_shared/community/community-at-depth.ts'

export type FixtureFile = {
    readonly pkg: string
    /** Path relative to `${pkg}/src/`. e.g. `state/store.ts`. */
    readonly relToSrc: string
}

export type FixtureEdge = {
    readonly from: FixtureFile
    readonly to: FixtureFile
}

export type FixtureSpec = {
    readonly files: readonly FixtureFile[]
    readonly edges: readonly FixtureEdge[]
    /** Which file paths the gate treats as the touched-community membership. Defaults to all files. */
    readonly touchedFiles?: readonly FixtureFile[]
    /** Community-assignment depth. Default 1. */
    readonly depth?: number
}

function absPathFor(f: FixtureFile): string {
    return `/synthetic/${f.pkg}/src/${f.relToSrc}`
}

function toSourceFile(f: FixtureFile): SourceFile {
    return {
        absolutePath: absPathFor(f),
        relativePath: `packages/${f.pkg}/src/${f.relToSrc}`,
        relToSrc: f.relToSrc,
        packageName: f.pkg,
    }
}

/**
 * Build a fully-formed ParsedSubgraph from a fixture spec.
 *
 * `getProject()` throws — synthetic fixtures never need ts-morph.
 * Tests for measures that DO need ts-morph (Martin abstractness,
 * boundary-width exports) should use the real {@link parseSubgraph}
 * against a tempdir of real .ts files instead.
 */
export function makeSyntheticSubgraph(spec: FixtureSpec): ParsedSubgraph {
    const depth = spec.depth ?? 1
    const filesByKey = new Map<string, SourceFile>()
    for (const f of spec.files) {
        const sf = toSourceFile(f)
        filesByKey.set(sf.absolutePath, sf)
    }
    const files: readonly SourceFile[] = [...filesByKey.values()].sort((a, b) =>
        a.absolutePath.localeCompare(b.absolutePath),
    )

    const edges: Edge[] = spec.edges.map(({from, to}) => {
        const fromSf = filesByKey.get(absPathFor(from))
        const toSf = filesByKey.get(absPathFor(to))
        if (!fromSf) throw new Error(`fixture edge from unknown file: ${absPathFor(from)}`)
        if (!toSf) throw new Error(`fixture edge to unknown file: ${absPathFor(to)}`)
        return {from: fromSf, to: toSf}
    })

    const communityMap = new Map<string, string>()
    for (const sf of files) {
        communityMap.set(sf.absolutePath, communityAtDepth(sf.packageName, sf.relToSrc, depth))
    }

    const touched = (spec.touchedFiles ?? spec.files)
        .map(f => communityMap.get(absPathFor(f)))
        .filter((c): c is string => c !== undefined)
    const touchedCommunities = [...new Set(touched)].sort()

    return {
        files,
        communityMap,
        edges,
        touchedCommunities,
        depth,
        getProject(): Project {
            throw new Error('synthetic ParsedSubgraph has no ts-morph project; use real parseSubgraph for AST tests')
        },
        getContent: () => null,
    }
}
