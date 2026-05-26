// Incremental Stryker mutation runner — mutate ONLY the source files this
// branch changed vs the configured base ref (default `origin/main`). The aim
// is to bring PR-time mutation cost in line with PR size, not package size.
//
// Public entry: `runIncrementalMutation(input, deps)`. The CLI shell at the
// bottom wires the default deps (real git, real stryker spawn) and exits with
// Stryker's exit code (preserving the config's `thresholds.break` gate).

import {execFile, spawn} from 'node:child_process'
import {readFile, readdir} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {promisify} from 'node:util'

import {minimatch} from 'minimatch'

const execFileAsync = promisify(execFile)

const SCRIPT_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SCRIPT_DIR, '..', '..', '..')
const DEFAULT_BASE_REF = 'origin/main'

// Base ref resolution order:
//   1. MUTATION_BASE_REF — explicit override (local + CI).
//   2. GITHUB_BASE_REF — GitHub Actions sets this on pull_request events; we
//      prefix `origin/` since the runner has a fetched remote ref.
//   3. DEFAULT_BASE_REF — local dev default.
// Pure: env in, string out. Exported for unit testing.
export function resolveBaseRef(env: NodeJS.ProcessEnv): string {
    const explicit = env['MUTATION_BASE_REF']
    if (explicit !== undefined && explicit.length > 0) return explicit
    const ghBase = env['GITHUB_BASE_REF']
    if (ghBase !== undefined && ghBase.length > 0) return `origin/${ghBase}`
    return DEFAULT_BASE_REF
}

export type IncrementalMutationInput = {
    readonly workspace: string
    readonly baseRef: string
    readonly repoRoot: string
}

export type IncrementalMutationResult =
    | {readonly kind: 'no-changes'; readonly exitCode: 0; readonly message: string}
    | {
        readonly kind: 'ran-stryker'
        readonly exitCode: number
        readonly strykerArgs: readonly string[]
        readonly mutatePaths: readonly string[]
        readonly workspaceDir: string
    }

export type IncrementalMutationDeps = {
    readonly getChangedFiles: (baseRef: string, cwd: string) => Promise<readonly string[]>
    readonly spawnStryker: (workspaceDir: string, args: readonly string[]) => Promise<number>
    readonly stderr: NodeJS.WritableStream
}

export async function runIncrementalMutation(
    input: IncrementalMutationInput,
    deps: IncrementalMutationDeps,
): Promise<IncrementalMutationResult> {
    const workspaceDir = await resolveWorkspaceDir(input.repoRoot, input.workspace)
    const mutatePatterns = await readMutatePatterns(workspaceDir)
    const changedRepoFiles = await deps.getChangedFiles(input.baseRef, input.repoRoot)
    const workspaceRelPaths = changedFilesInWorkspace(changedRepoFiles, input.repoRoot, workspaceDir)
    const mutatePaths = filterByMutatePatterns(workspaceRelPaths, mutatePatterns)
    if (mutatePaths.length === 0) {
        const message = `[run-mutation-incremental] no source files changed in workspace ${input.workspace} vs ${input.baseRef}`
        deps.stderr.write(`${message}\n`)
        return {kind: 'no-changes', exitCode: 0, message}
    }
    const strykerArgs: readonly string[] = ['run', 'stryker.config.json', '--mutate', mutatePaths.join(',')]
    deps.stderr.write(`[run-mutation-incremental] mutating ${mutatePaths.length} file(s) in ${input.workspace} vs ${input.baseRef}:\n`)
    for (const p of mutatePaths) deps.stderr.write(`  · ${p}\n`)
    const exitCode = await deps.spawnStryker(workspaceDir, strykerArgs)
    return {kind: 'ran-stryker', exitCode, strykerArgs, mutatePaths, workspaceDir}
}

// ── internals (intentionally NOT exported) ──────────────────────────────────

async function resolveWorkspaceDir(repoRoot: string, workspaceName: string): Promise<string> {
    const librariesRoot = join(repoRoot, 'packages', 'libraries')
    let entries: readonly {isDirectory(): boolean; name: string}[]
    try {
        entries = await readdir(librariesRoot, {withFileTypes: true})
    } catch (err) {
        throw new Error(
            `cannot read libraries root ${librariesRoot}: ${(err as Error).message}`,
        )
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue
        const pkgPath = join(librariesRoot, e.name, 'package.json')
        let raw: string
        try {
            raw = await readFile(pkgPath, 'utf8')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
            throw err
        }
        let parsed: {name?: unknown}
        try {
            parsed = JSON.parse(raw) as {name?: unknown}
        } catch {
            continue
        }
        if (parsed.name === workspaceName) return join(librariesRoot, e.name)
    }
    throw new Error(
        `workspace '${workspaceName}' not found under ${librariesRoot}. ` +
        `Supported workspaces are the package.json#name values of directories ` +
        `under packages/libraries/.`,
    )
}

async function readMutatePatterns(workspaceDir: string): Promise<readonly string[]> {
    const cfgPath = join(workspaceDir, 'stryker.config.json')
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as {mutate?: unknown}
    const mutate = cfg.mutate
    if (!Array.isArray(mutate) || !mutate.every((p): p is string => typeof p === 'string')) {
        throw new Error(`${cfgPath} 'mutate' must be a string[]`)
    }
    return mutate
}

// Filter repo-relative paths to ones under workspaceDir, returning paths made
// relative to workspaceDir. Non-.ts files are dropped (Stryker only mutates
// TypeScript here).
function changedFilesInWorkspace(
    changedRepoFiles: readonly string[],
    repoRoot: string,
    workspaceDir: string,
): readonly string[] {
    const rel = relative(repoRoot, workspaceDir).replace(/\\/g, '/')
    const prefix = `${rel}/`
    const out: string[] = []
    for (const f of changedRepoFiles) {
        const norm = f.replace(/\\/g, '/')
        if (!norm.startsWith(prefix)) continue
        if (!norm.endsWith('.ts')) continue
        out.push(norm.slice(prefix.length))
    }
    return out
}

// Apply Stryker-style mutate patterns: include first, then `!`-prefixed
// negations exclude. Order matters; later patterns override earlier ones.
function filterByMutatePatterns(
    workspaceRelPaths: readonly string[],
    patterns: readonly string[],
): readonly string[] {
    const out: string[] = []
    for (const file of workspaceRelPaths) {
        let included = false
        for (const p of patterns) {
            if (p.startsWith('!')) {
                if (minimatch(file, p.slice(1))) included = false
            } else {
                if (minimatch(file, p)) included = true
            }
        }
        if (included) out.push(file)
    }
    return out
}

async function ensureBaseRefFetched(baseRef: string, cwd: string): Promise<void> {
    const slash = baseRef.indexOf('/')
    if (slash <= 0) return // local ref or bare SHA — leave alone
    const remote = baseRef.slice(0, slash)
    const branch = baseRef.slice(slash + 1)
    try {
        await execFileAsync('git', ['fetch', '--no-tags', '--depth=1', remote, branch], {
            cwd, maxBuffer: 32 * 1024 * 1024,
        })
    } catch {
        // If the fetch fails, the diff below will surface a clearer error.
    }
}

// ── default impure deps ─────────────────────────────────────────────────────

export function defaultDeps(): IncrementalMutationDeps {
    return {
        getChangedFiles: async (baseRef, cwd) => {
            // GHA's default `actions/checkout@v4` is shallow (depth 1); the
            // base ref isn't available locally. Best-effort fetch so the
            // `<baseRef>..HEAD` diff can resolve. No-op for already-fetched
            // refs / local-only refs / bare SHAs.
            await ensureBaseRefFetched(baseRef, cwd)
            // Union of:
            //   1. committed branch diffs vs baseRef
            //   2. working-tree diffs vs HEAD (staged + unstaged)
            // Use two-dot because shallow CI clones may not have the merge-base
            // needed for triple-dot. (2) lets local dev iteration without a
            // fresh commit also mutate the right files.
            const [committed, working] = await Promise.all([
                execFileAsync('git', ['diff', '--name-only', `${baseRef}..HEAD`], {
                    cwd, maxBuffer: 32 * 1024 * 1024,
                }),
                execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
                    cwd, maxBuffer: 32 * 1024 * 1024,
                }),
            ])
            const all = new Set<string>()
            for (const stdout of [committed.stdout, working.stdout]) {
                for (const line of stdout.split('\n')) {
                    if (line.length > 0) all.add(line)
                }
            }
            return [...all]
        },
        spawnStryker: (workspaceDir, args) => new Promise<number>((resolveExit, reject) => {
            const strykerBin = join(REPO_ROOT, 'node_modules', '.bin', 'stryker')
            const child = spawn(strykerBin, [...args], {cwd: workspaceDir, stdio: 'inherit'})
            child.on('error', reject)
            child.on('exit', (code, signal) => {
                if (signal) resolveExit(128 + (typeof signal === 'string' ? 0 : 0))
                else resolveExit(code ?? 1)
            })
        }),
        stderr: process.stderr,
    }
}

// ── CLI shell ───────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const argv = process.argv.slice(2)
    const workspace = argv[0]
    if (!workspace) {
        console.error('usage: run-mutation-incremental.ts <workspace>')
        console.error('  e.g. run-mutation-incremental.ts @vt/graph-state')
        console.error('  env: MUTATION_BASE_REF (default: origin/$GITHUB_BASE_REF or origin/main)')
        process.exit(64)
    }
    const baseRef = resolveBaseRef(process.env)
    runIncrementalMutation({workspace, baseRef, repoRoot: REPO_ROOT}, defaultDeps())
        .then(result => process.exit(result.exitCode))
        .catch(err => { console.error(err); process.exit(2) })
}
