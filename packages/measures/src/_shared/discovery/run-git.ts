import {execFileSync, type ExecFileSyncOptionsWithStringEncoding} from 'node:child_process'

// Git exports GIT_DIR (and sometimes GIT_WORK_TREE) into the environment of any
// hook it runs (pre-commit, pre-push, …). When GIT_DIR is set WITHOUT
// GIT_WORK_TREE, working-tree commands such as `git ls-files` abort with
//   fatal: this operation must be run in a work tree
// because the inherited GIT_DIR overrides the cwd-based repository discovery
// those commands rely on. Server-side CI is unaffected (no hook wrapper exports
// GIT_DIR there), so the breakage only bites git operations invoked from a local
// hook — e.g. the architecture-drift / source-of-truth health checks during a
// local push, which silently report as failures.
//
// Stripping both overrides restores cwd-based resolution, which is exactly what
// every measure git call already wants: they each pass an explicit `cwd` and
// never depend on an ambient GIT_DIR.
export function envWithoutGitLocationOverrides(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => key !== 'GIT_DIR' && key !== 'GIT_WORK_TREE',
        ),
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
