import {realpathSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'

export const VOICETREE_HOME_PATH_ENV: string = 'VOICETREE_HOME_PATH'
export const VOICETREE_DIRNAME: string = '.voicetree'

/**
 * Canonicalize a project path to its true on-disk form.
 *
 * Returns the path exactly as the filesystem stores it (`realpathSync.native`),
 * which fixes the casing and resolves symlinks. This is the single place where a
 * project path's identity is decided, so every derived value — the watched dir,
 * persisted project record, node-ID base, worktree spawn cwd — agrees.
 *
 * Why `realpathSync.native` and not a manual `toLowerCase()`: case-folding is a
 * property of the *filesystem*, not the path string. On a case-insensitive
 * filesystem (APFS, NTFS) `~/Voicetree` and `~/voicetree` are one directory and
 * collapse to a single canonical string; on a case-sensitive filesystem (most
 * Linux) they are genuinely different directories and stay distinct. Delegating
 * to the OS keeps this correct on every platform without hard-coding case rules.
 *
 * Falls back to `path.resolve` when the path cannot be resolved (e.g. it does not
 * exist yet) so the edge never throws on an absent path.
 */
export function normalizeProjectPath(rawPath: string): string {
    const absolutePath: string = resolve(rawPath)
    try {
        return realpathSync.native(absolutePath)
    } catch {
        return absolutePath
    }
}

export function getVoicetreeHomePath(input: {
    readonly env: NodeJS.ProcessEnv
    readonly homePath: string
}): string {
    return input.env[VOICETREE_HOME_PATH_ENV]?.trim() || join(input.homePath, VOICETREE_DIRNAME)
}

export function resolveVoicetreeHomePath(): string {
    return getVoicetreeHomePath({
        env: process.env,
        homePath: homedir(),
    })
}

export function getProjectDotVoicetreePath(projectPath: string): string {
    return join(projectPath, VOICETREE_DIRNAME)
}
