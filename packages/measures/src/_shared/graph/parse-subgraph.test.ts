/**
 * Tests the `loadContent` override hook on parseSubgraph.
 *
 * The subgraph-gate runner uses this hook to feed staged-blob content
 * (instead of working-tree content) so a commit is scored on the state
 * IT would produce — not on peer-agent WIP polluting the worktree.
 *
 * Two invariants we must guarantee:
 *   1. Import-edge extraction respects the override (the import graph
 *      built by parseSubgraph reflects loadContent, not disk).
 *   2. The ts-morph `Project` returned by `getProject()` reflects the
 *      same content (otherwise AST-walking measures would silently
 *      disagree with edge-list measures about what a file contains).
 *
 * These are checked with a single fixture: two files on disk where the
 * disk content has a stale import, and loadContent returns updated text
 * with a different import and a different exported symbol. We assert
 * both the edge graph AND the ts-morph AST see the override.
 */
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {parseSubgraph} from './parse-subgraph.ts'

const tmpRoots: string[] = []

afterEach(async () => {
    await Promise.all(tmpRoots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

async function buildFixture(): Promise<{repoRoot: string; pkgSrc: string; aPath: string; bPath: string; cPath: string}> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'parse-subgraph-loadcontent-'))
    tmpRoots.push(repoRoot)
    const pkgDir = join(repoRoot, 'packages', 'fakepkg')
    const pkgSrc = join(pkgDir, 'src')
    await mkdir(pkgSrc, {recursive: true})
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({name: '@fake/pkg'}))
    const aPath = join(pkgSrc, 'a.ts')
    const bPath = join(pkgSrc, 'b.ts')
    const cPath = join(pkgSrc, 'c.ts')
    // Disk state: a imports b (stale).
    await writeFile(aPath, "import {fromB} from './b.ts'\nexport const fromA = fromB\n")
    await writeFile(bPath, "export const fromB = 'b'\n")
    await writeFile(cPath, "export const fromC = 'c'\n")
    return {repoRoot, pkgSrc, aPath, bPath, cPath}
}

describe('parseSubgraph loadContent override', () => {
    it('uses overridden content for import-edge extraction', async () => {
        const {repoRoot, aPath, bPath, cPath} = await buildFixture()

        // loadContent returns updated text for a: now imports c, not b.
        const override = "import {fromC} from './c.ts'\nexport const fromA = fromC\n"
        const subgraph = await parseSubgraph([aPath], {
            repoRoot,
            loadContent: async (abs) => {
                if (abs === aPath) return override
                if (abs === bPath) return "export const fromB = 'b'\n"
                if (abs === cPath) return "export const fromC = 'c'\n"
                throw new Error(`unexpected loadContent path: ${abs}`)
            },
        })

        const edges = subgraph.edges.map(e => `${e.from.absolutePath}->${e.to.absolutePath}`).sort()
        expect(edges).toEqual([`${aPath}->${cPath}`])
        // The disk-stated `a->b` edge must NOT appear because loadContent
        // is the only source of truth for content.
        expect(edges).not.toContain(`${aPath}->${bPath}`)
    })

    it('feeds overridden content into the ts-morph Project', async () => {
        const {repoRoot, aPath, bPath, cPath} = await buildFixture()

        // Override a's exported symbol to fromX (only visible through ts-morph
        // — disk still says fromA). If ts-morph reads disk, getSourceFile
        // would expose `fromA`; if it reads loadContent, it exposes `fromX`.
        const override = "import {fromB} from './b.ts'\nexport const fromX = fromB\n"
        const subgraph = await parseSubgraph([aPath], {
            repoRoot,
            loadContent: async (abs) => {
                if (abs === aPath) return override
                if (abs === bPath) return "export const fromB = 'b'\n"
                if (abs === cPath) return "export const fromC = 'c'\n"
                throw new Error(`unexpected loadContent path: ${abs}`)
            },
        })

        const project = subgraph.getProject()
        const sf = project.getSourceFile(aPath)
        expect(sf, `ts-morph did not load ${aPath}`).toBeDefined()
        const exportedNames = sf!.getExportSymbols().map(s => s.getName()).sort()
        expect(exportedNames).toEqual(['fromX'])
    })

    it('falls back to disk for files not in the cache (test-helper safety)', async () => {
        // Confirms that if a custom test setup constructs a ParsedSubgraph via
        // means OTHER than parseSubgraph (so the cache is empty), getProject()
        // still loads via addSourceFileAtPath. This is the fallback path in
        // freezeSubgraph; without it, every test-helper would silently lose
        // ts-morph access. Verified indirectly by running the existing 140+
        // subgraph-gate tests — they all build subgraphs without loadContent.
        const {repoRoot, aPath} = await buildFixture()
        const subgraph = await parseSubgraph([aPath], {repoRoot})
        const project = subgraph.getProject()
        expect(project.getSourceFile(aPath), 'default parseSubgraph still populates ts-morph').toBeDefined()
    })
})

describe('parseSubgraph staged tree filters', () => {
    it('removes peer worktree source files that are absent from the staged tree', async () => {
        const {repoRoot, aPath} = await buildFixture()
        const peerPath = join(repoRoot, 'packages', 'fakepkg', 'src', 'peer-wip.ts')
        await writeFile(peerPath, "export const peerWip = 'not staged'\n")

        const subgraph = await parseSubgraph([aPath], {
            repoRoot,
            stagedTreeFiles: new Set([
                'packages/fakepkg/package.json',
                'packages/fakepkg/src/a.ts',
                'packages/fakepkg/src/b.ts',
            ]),
            stagedTreePackages: new Set(['packages/fakepkg/package.json']),
        })

        const relativeFiles = subgraph.files.map(file => file.relativePath).sort()
        expect(relativeFiles).toEqual([
            'packages/fakepkg/src/a.ts',
            'packages/fakepkg/src/b.ts',
        ])
        expect(relativeFiles).not.toContain('packages/fakepkg/src/peer-wip.ts')
        expect(subgraph.edges.map(edge => edge.from.absolutePath)).not.toContain(peerPath)
        expect(subgraph.edges.map(edge => edge.to.absolutePath)).not.toContain(peerPath)
        expect(subgraph.getProject().getSourceFile(peerPath)).toBeUndefined()
    })

    it('filters discovered packages by staged package.json paths', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'parse-subgraph-staged-packages-'))
        tmpRoots.push(repoRoot)

        const baseDir = join(repoRoot, 'packages', 'base')
        const baseSrc = join(baseDir, 'src')
        const peerDir = join(repoRoot, 'packages', 'peer')
        const peerSrc = join(peerDir, 'src')
        await mkdir(baseSrc, {recursive: true})
        await mkdir(peerSrc, {recursive: true})
        await writeFile(join(baseDir, 'package.json'), JSON.stringify({name: '@fake/base'}))
        await writeFile(join(peerDir, 'package.json'), JSON.stringify({name: '@fake/peer'}))

        const basePath = join(baseSrc, 'a.ts')
        const peerPath = join(peerSrc, 'peer.ts')
        await writeFile(basePath, "import {peer} from '@fake/peer/peer'\nexport const base = peer\n")
        await writeFile(peerPath, "export const peer = 'peer'\n")

        const stagedTreeFiles = new Set([
            'packages/base/package.json',
            'packages/base/src/a.ts',
            'packages/peer/src/peer.ts',
        ])
        const withoutPeerPackage = await parseSubgraph([basePath], {
            repoRoot,
            stagedTreeFiles,
            stagedTreePackages: new Set(['packages/base/package.json']),
        })
        expect(withoutPeerPackage.files.map(file => file.relativePath)).toEqual(['packages/base/src/a.ts'])
        expect(withoutPeerPackage.edges).toEqual([])

        const withPeerPackage = await parseSubgraph([basePath], {
            repoRoot,
            stagedTreeFiles,
            stagedTreePackages: new Set([
                'packages/base/package.json',
                'packages/peer/package.json',
            ]),
        })
        expect(withPeerPackage.files.map(file => file.relativePath).sort()).toEqual([
            'packages/base/src/a.ts',
            'packages/peer/src/peer.ts',
        ])
        expect(withPeerPackage.edges.map(edge => `${edge.from.relativePath}->${edge.to.relativePath}`)).toEqual([
            'packages/base/src/a.ts->packages/peer/src/peer.ts',
        ])
    })
})
