/**
 * Test-only helpers for the three shape measures.
 *
 * Builds a hand-rolled {@link ParsedSubgraph} in memory:
 *   - source text is written to a temp dir (ts-morph won't reliably load
 *     in-memory virtual files via `addSourceFileAtPath`, so we use real
 *     files in a per-test temp dir)
 *   - the returned subgraph has a single touched community, every file
 *     mapped to that community
 *
 * Keeps the per-measure tests focused on AST semantics; the
 * `parseSubgraph` integration is covered separately under `_shared/`.
 */
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {Project} from 'ts-morph'
import {communityAtDepth} from '../../../_shared/community/community-at-depth.ts'
import type {SourceFile, Edge} from '../../../_shared/graph/import-graph.ts'
import type {ParsedSubgraph} from '../../../_shared/graph/parse-subgraph.ts'

export type SyntheticFile = {
    /** Repo-relative path (e.g. 'packages/foo/src/a/m.ts'); used as `relativePath`. */
    readonly relativePath: string
    readonly text: string
    /** Package name (defaults to 'pkg' if omitted). */
    readonly packageName?: string
    /** Path relative to the package's `src/` root (defaults to relativePath after `pkg/src/`). */
    readonly relToSrc?: string
}

export type SyntheticSubgraph = {
    readonly subgraph: ParsedSubgraph
    readonly tmpDir: string
    cleanup(): Promise<void>
}

export async function buildSyntheticSubgraph(
    files: readonly SyntheticFile[],
    depth: number = 1,
): Promise<SyntheticSubgraph> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'shape-measures-test-'))

    const sourceFiles: SourceFile[] = []
    for (const f of files) {
        const abs = resolve(tmpDir, f.relativePath)
        await mkdir(dirname(abs), {recursive: true})
        await writeFile(abs, f.text, 'utf8')
        sourceFiles.push({
            absolutePath: abs,
            relativePath: f.relativePath,
            relToSrc: f.relToSrc ?? f.relativePath,
            packageName: f.packageName ?? 'pkg',
        })
    }

    // Map each file to its community at the requested depth — gives tests
    // honest community assignment rather than a forced single bucket.
    const communityMap = new Map<string, string>()
    const touched = new Set<string>()
    for (const sf of sourceFiles) {
        const c = communityAtDepth(sf.packageName, sf.relToSrc, depth)
        communityMap.set(sf.absolutePath, c)
        touched.add(c)
    }

    const edges: Edge[] = []

    let cachedProject: Project | null = null
    const getProject = (): Project => {
        if (cachedProject) return cachedProject
        const project = new Project({useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true})
        for (const sf of sourceFiles) project.addSourceFileAtPath(sf.absolutePath)
        cachedProject = project
        return project
    }

    // Falls back to the disk content the helper just wrote (so any measure
    // that uses getContent picks up the same fixture text the test set up).
    const fileTexts = new Map(files.map((f, i) => [sourceFiles[i].absolutePath, f.text]))
    const getContent = (absPath: string): string | null => fileTexts.get(absPath) ?? null

    const subgraph: ParsedSubgraph = {
        files: sourceFiles,
        communityMap,
        edges,
        touchedCommunities: [...touched].sort(),
        depth,
        getProject,
        getContent,
    }

    return {
        subgraph,
        tmpDir,
        cleanup: async () => { await rm(tmpDir, {recursive: true, force: true}) },
    }
}
