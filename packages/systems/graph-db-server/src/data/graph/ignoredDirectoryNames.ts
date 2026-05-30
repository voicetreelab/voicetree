/**
 * Directory names the graph-db layer must never descend into when loading or
 * watching a project tree — vendored deps, build artifacts, virtualenvs, and
 * the worktrees staging dir.
 *
 * Single source of truth shared by the cold disk loader (`loadGraphFromDisk`)
 * and the live folder watcher (`file-watcher-setup`), so watch-time filtering
 * and initial-load filtering agree: a file the cold load skips must also be
 * skipped when added later.
 *
 * Hidden directories (names starting with `.`, most notably `.voicetree/`) are
 * handled separately by each caller's `.`-prefix check, so this set lists only
 * the dotless noise directories (plus `.worktrees`, a temporary migration
 * entry). `build` is included so opening a repo as a project doesn't pull every
 * `.md` under build outputs into the graph and trip the file-limit guard on
 * large monorepos.
 *
 * NB: `folderScanner` keeps its own, deliberately different variant (it ignores
 * `.git` but not `build`); do not fold it into this set without reconciling
 * that behavior.
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    '.next',
    'dist',
    '.cache',
    '__pycache__',
    '.tox',
    '.venv',
    'venv',
    'build',
    // TODO: drop once migrate-worktrees-to-sibling.sh has run and .worktrees/ is empty.
    '.worktrees',
])
