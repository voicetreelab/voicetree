import {execFileSync, type ExecFileSyncOptionsWithStringEncoding} from 'node:child_process'

// Git exports its location-pointing variables (GIT_DIR, GIT_WORK_TREE, and —
// inside a linked worktree — GIT_COMMON_DIR, plus GIT_INDEX_FILE / GIT_PREFIX)
// into the environment of any hook it runs (pre-commit, pre-push, …). When any
// of these is inherited, working-tree commands run against the HOOK's repo
// rather than the cwd we point them at:
//   - `git ls-files` aborts with "fatal: this operation must be run in a work tree"
//   - `git init` in a sandbox writes refs to the leaked GIT_COMMON_DIR and dies
//     with "<sandbox>/.git/refs/heads: No such file or directory"
// Server-side CI is unaffected (no hook wrapper exports these there), so the
// breakage only bites git operations invoked from a local hook — e.g. the
// architecture-drift / source-of-truth health checks during a local push.
//
// Stripping every location override restores cwd-based resolution, which is
// exactly what every measure git call already wants: they each pass an explicit
// `cwd` and never depend on an ambient GIT_DIR.
const GIT_LOCATION_OVERRIDE_VARS = new Set([
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_PREFIX',
])

function envWithoutGitLocationOverrides(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !GIT_LOCATION_OVERRIDE_VARS.has(key)),
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
    return execFileSync('git', [...args], {
        ...options,
        cwd,
        encoding: 'utf8',
        env: envWithoutGitLocationOverrides(),
    })
}
