/**
 * On-disk fixture helper for measures that need real .ts file content.
 *
 * `boundary-width` and `martin-distance` both invoke TS AST parsing
 * over file bodies — synthetic in-memory ParsedSubgraph fixtures lose
 * that signal. This helper:
 *   - mkdir -p a temporary repo root
 *   - writes a minimal `package.json` per fake package
 *   - writes the named files under `${pkg}/src/${relToSrc}`
 *   - returns the root path so tests can call {@link parseSubgraph}
 *     with `{repoRoot}` pointed at the tempdir
 *
 * Cleanup: caller is responsible for `rm -rf` (or skip — vitest tempdirs
 * are gc'd by the OS eventually). The helper deliberately doesn't
 * auto-register a vitest afterAll hook; that would couple the helper to
 * vitest's globals and trip when imported from non-test contexts.
 */
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'

export type FixtureFileSpec = {
    /** Package directory name AND npm name (we set them equal for simplicity). */
    readonly pkg: string
    /** Path under `${pkg}/src/`. e.g. `state/store.ts`. */
    readonly relToSrc: string
    readonly contents: string
}

export type Fixture = {
    /** Absolute path to the tempdir that acts as the repo root. */
    readonly repoRoot: string
    /** Absolute paths of all written files (in deterministic order). */
    readonly absolutePaths: readonly string[]
    /** Cleanup — remove the tempdir tree. */
    cleanup(): Promise<void>
}

/**
 * Build the tempdir layout. One package per unique `pkg`, each with a
 * `package.json` (so `discoverPackages` picks it up) and a `src/` tree.
 *
 * `options.layerPrefix` nests the packages under a sub-path (e.g.
 * `packages/libraries`) — useful for measures that scope by relativePath
 * patterns.
 */
export async function buildTempRepo(
    files: readonly FixtureFileSpec[],
    options: {readonly layerPrefix?: string} = {},
): Promise<Fixture> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'subgraph-measure-fixture-'))
    const layerPrefix = options.layerPrefix ?? ''
    const packages = new Set(files.map(f => f.pkg))

    for (const pkg of packages) {
        const pkgDir = join(repoRoot, layerPrefix, pkg)
        await mkdir(join(pkgDir, 'src'), {recursive: true})
        await writeFile(
            join(pkgDir, 'package.json'),
            JSON.stringify({name: pkg, version: '0.0.0', private: true}, null, 2),
            'utf8',
        )
    }

    const absolutePaths: string[] = []
    for (const f of files) {
        const abs = join(repoRoot, layerPrefix, f.pkg, 'src', f.relToSrc)
        await mkdir(dirname(abs), {recursive: true})
        await writeFile(abs, f.contents, 'utf8')
        absolutePaths.push(abs)
    }
    absolutePaths.sort()
    return {
        repoRoot,
        absolutePaths,
        async cleanup() {
            try {
                await rm(repoRoot, {recursive: true, force: true})
            } catch {
                // Best effort; tests are often re-run.
            }
        },
    }
}
