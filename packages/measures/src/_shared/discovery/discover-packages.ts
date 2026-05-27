import {readFile, readdir, stat} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// A node_modules-style conditional-exports value: either a literal file path
// or an object mapping conditions (import/default/require/types) to file paths.
export type ConditionalExport =
    | string
    | {
        readonly import?: string
        readonly default?: string
        readonly require?: string
        readonly types?: string
    }

// The shape of a package.json `exports` field. Either the string-shorthand for the root export,
// a single conditional object for the root, or a subpath map keyed by "./..." entries.
export type PackageExports =
    | string
    | {readonly [subpath: string]: ConditionalExport}

export type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
    readonly absDir: string
    readonly main: string | undefined
    readonly exports: PackageExports | undefined
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

type ParsedPackageJson = {
    readonly name?: unknown
    readonly main?: unknown
    readonly exports?: unknown
}

async function readdirOrEmpty(absDir: string): Promise<Awaited<ReturnType<typeof readdir>>> {
    try {
        return await readdir(absDir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
}

async function readPackageJson(absDir: string): Promise<ParsedPackageJson | null> {
    const pkgJsonPath = join(absDir, 'package.json')
    if (!(await pathExists(pkgJsonPath))) return null
    try {
        return JSON.parse(await readFile(pkgJsonPath, 'utf8'))
    } catch {
        return null
    }
}

function validateExports(raw: unknown): PackageExports | undefined {
    if (typeof raw === 'string') return raw
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    return raw as PackageExports
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
                        main: typeof pkgJson.main === 'string' ? pkgJson.main : undefined,
                        exports: validateExports(pkgJson.exports),
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
