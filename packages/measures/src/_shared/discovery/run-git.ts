import {execFileSync, type ExecFileSyncOptionsWithStringEncoding} from 'node:child_process'

// Git exports a whole family of location-pinning vars into the environment of any
// hook it runs (pre-commit, pre-push, …): GIT_DIR, GIT_COMMON_DIR, GIT_WORK_TREE,
// GIT_INDEX_FILE, GIT_OBJECT_DIRECTORY, … Any of them overrides the cwd-based
// repository discovery that working-tree commands (`git ls-files`, `git init`)
// rely on, so a measure that runs `git` in some OTHER directory (e.g. a freshly
// `git init`-ed test sandbox) is silently retargeted at the hook's repo and aborts
// with `fatal: not a git repository` / `must be run in a work tree`. Server-side CI
// is unaffected (no hook wrapper exports them), so this only bites git operations
// invoked from a local hook — e.g. the architecture-drift / source-of-truth checks
// during a local push.
//
// Stripping the full set restores pure cwd-based resolution, which is exactly what
// every measure git call wants: they each pass an explicit `cwd` and never depend
// on an ambient git location. Exported so callers that spawn git directly (e.g.
// test scaffolding that `git init`s a sandbox) can be made equally hermetic.
const GIT_LOCATION_ENV_VARS = [
    'GIT_DIR',
    'GIT_COMMON_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES',
]

export function gitEnvWithoutLocationOverrides(): NodeJS.ProcessEnv {
    const stripped = new Set(GIT_LOCATION_ENV_VARS)
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !stripped.has(key)),
    )
}

// Run a git working-tree command (e.g. `ls-files`) rooted at `cwd`, immune to a
// GIT_DIR/GIT_WORK_TREE leaked by an enclosing git hook. Returns stdout as utf8.
// Use this for any git invocation that requires a work tree; GIT_DIR-safe
// commands (`diff --cached`, `show`, `rev-parse`) do not need it but are not
// harmed by it.
export function runGitWorktreeCommand(
    args: readonly string[],
    cwd: string,
    options: Omit<ExecFileSyncOptionsWithStringEncoding, 'cwd' | 'env' | 'encoding'> = {},
): string {
    try {
        return execFileSync('git', [...args], {
            ...options,
            cwd,
            encoding: 'utf8',
            env: gitEnvWithoutLocationOverrides(),
        })
    } catch (err) {
        const e = err as {stderr?: Buffer | string; status?: number}
        throw new Error(`git ${args.join(' ')} (cwd=${cwd}) exited ${e.status}: ${String(e.stderr ?? '').trim()}`)
    }
}
