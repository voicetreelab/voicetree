import {readFile, readdir, stat} from 'node:fs/promises'
import {basename, dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
    readonly absDir: string
    /**
     * Repo-relative paths of files declared as the package's public facade
     * via `package.json` exports. Used by the BCI facade-discount: edges
     * crossing into these files are not charged. Empty when the package
     * has no exports field or none resolve to a .ts/.tsx file.
     */
    readonly facadeRelativePaths: readonly string[]
}

const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'dist-electron',
    'dist-test',
    'out',
    'build',
    '.git',
    '.venv',
    'coverage',
    '.worktrees',
    '__tests__',
])

const EXCLUDED_RELATIVE_PATHS: ReadonlySet<string> = new Set([
    'brain',
    'vt-website-quartz',
    'voicetree-evals',
])

const THIS_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO_ROOT: string = resolve(THIS_FILE_DIR, '..', '..', '..', '..', '..')

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function readdirOrEmpty(absDir: string): Promise<Awaited<ReturnType<typeof readdir>>> {
    try {
        return await readdir(absDir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
}

async function readPackageJson(absDir: string): Promise<{name?: unknown, exports?: unknown} | null> {
    const pkgJsonPath = join(absDir, 'package.json')
    if (!(await pathExists(pkgJsonPath))) return null
    try {
        return JSON.parse(await readFile(pkgJsonPath, 'utf8'))
    } catch {
        return null
    }
}

/**
 * Walk the `exports` field — accepts string, subpath map, conditional
 * map, or nested combinations — and collect every leaf string value that
 * looks like a TypeScript source file. These are the package's declared
 * facade entry points.
 */
function collectFacadeStrings(exportsField: unknown): string[] {
    const out: string[] = []
    function walk(v: unknown): void {
        if (typeof v === 'string') {
            if (v.endsWith('.ts') || v.endsWith('.tsx')) out.push(v)
            return
        }
        if (v === null || typeof v !== 'object') return
        for (const value of Object.values(v as Record<string, unknown>)) walk(value)
    }
    walk(exportsField)
    return out
}

function resolveFacadeRelativePaths(
    absDir: string,
    repoRoot: string,
    exportsField: unknown,
): readonly string[] {
    const seen = new Set<string>()
    for (const raw of collectFacadeStrings(exportsField)) {
        const abs = resolve(absDir, raw)
        seen.add(relative(repoRoot, abs))
    }
    return [...seen].sort()
}

async function isNestedGitRoot(absDir: string, repoRoot: string): Promise<boolean> {
    return absDir !== repoRoot && await pathExists(join(absDir, '.git'))
}

export async function discoverPackages(repoRoot: string = DEFAULT_REPO_ROOT): Promise<readonly PackageInfo[]> {
    const found: PackageInfo[] = []

    async function walk(absDir: string, relDir: string): Promise<void> {
        if (await isNestedGitRoot(absDir, repoRoot)) return

        if (absDir !== repoRoot) {
            const pkgJson = await readPackageJson(absDir)
            if (pkgJson && typeof pkgJson.name === 'string' && pkgJson.name.length > 0) {
                const srcDir = join(absDir, 'src')
                if (await pathExists(srcDir)) {
                    found.push({
                        name: pkgJson.name,
                        dirName: basename(absDir),
                        srcRoot: srcDir,
                        absDir,
                        facadeRelativePaths: resolveFacadeRelativePaths(absDir, repoRoot, pkgJson.exports),
                    })
                }
            }
        }

        const entries = await readdirOrEmpty(absDir)
        await Promise.all(entries.map(async entry => {
            if (!entry.isDirectory()) return
            if (EXCLUDED_DIR_NAMES.has(entry.name)) return
            const childRel = relDir ? join(relDir, entry.name) : entry.name
            if (EXCLUDED_RELATIVE_PATHS.has(childRel)) return
            await walk(join(absDir, entry.name), childRel)
        }))
    }

    await walk(repoRoot, '')
    return found.sort((a, b) => a.dirName.localeCompare(b.dirName))
}
