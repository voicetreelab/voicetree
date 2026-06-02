import {statSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {getProjectDotVoicetreePath} from './paths.ts'

export const VOICETREE_PROJECT_PATH_ENV: string = 'VOICETREE_PROJECT_PATH'

/**
 * True when `candidatePath` directly contains a `.voicetree/` directory, i.e.
 * it is a project root. The single place that decides "is this a project?",
 * shared by the up-walk and the `$VOICETREE_PROJECT_PATH` check so the two can
 * never disagree.
 */
export function hasVoicetreeMarker(candidatePath: string): boolean {
    try {
        return statSync(getProjectDotVoicetreePath(candidatePath)).isDirectory()
    } catch {
        return false
    }
}

/**
 * Walk up from `cwd` to the nearest ancestor that is a project root (contains
 * `.voicetree/`). Returns that directory, or null if no ancestor qualifies.
 * Stops at the *innermost* match — when projects are nested, the deepest wins.
 */
export function detectProjectFromCwd(cwd: string): string | null {
    let currentPath: string = resolve(cwd)

    for (;;) {
        if (hasVoicetreeMarker(currentPath)) {
            return currentPath
        }

        const parentPath: string = dirname(currentPath)
        if (parentPath === currentPath) {
            return null
        }

        currentPath = parentPath
    }
}

/**
 * Resolve the project root for a CLI invocation, with `$VOICETREE_PROJECT_PATH`
 * authoritative over the CWD up-walk.
 *
 * Precedence:
 *   1. `$VOICETREE_PROJECT_PATH`, when set and itself a project root — the
 *      spawner sets this to the canonical root the app talks to, so it MUST win
 *      over the CWD walk. Without this, an agent whose CWD sits inside a nested
 *      project subfolder (carrying its own leftover `.voicetree/`) resolves the
 *      *inner* project and binds the wrong per-project daemon, while the app
 *      reads the outer one.
 *   2. CWD up-walk — the interactive-human path, when the env var is unset (or
 *      points at something that is not a project root).
 *
 * Returns null when neither yields a project root. Callers layer their own
 * higher-precedence overrides (an explicit `--project` flag, a
 * `$VOICETREE_DAEMON_URL`) on top of this.
 */
export function resolveProjectRoot(input: {
    readonly cwd: string
    readonly env: Record<string, string | undefined>
}): string | null {
    const envProjectPath: string | undefined = input.env[VOICETREE_PROJECT_PATH_ENV]
    if (envProjectPath && envProjectPath.length > 0) {
        const resolved: string = resolve(envProjectPath)
        if (hasVoicetreeMarker(resolved)) {
            return resolved
        }
    }

    return detectProjectFromCwd(input.cwd)
}
