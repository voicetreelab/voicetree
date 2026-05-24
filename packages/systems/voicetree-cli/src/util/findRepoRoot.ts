/**
 * Walk up from the calling module (or the CLI's cwd as a fallback) to find
 * the repository root. The root is identified by the presence of a `.git`
 * entry (directory in a normal clone, file in a git worktree). `.git` is
 * the only marker guaranteed to live at, and only at, the repo root in
 * every supported checkout.
 *
 * Centralising this here lets call sites avoid hardcoded `../../…/…` string
 * literals that the relative-path-depth gate
 * (`scripts/measure-relative-paths.mjs --enforce`) flags as bans.
 */

import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const REPO_ROOT_MARKER: string = '.git'

export function findRepoRoot(callerModuleUrl: string): string {
    const startDir: string = dirname(fileURLToPath(callerModuleUrl))
    for (const dir of [startDir, process.cwd()]) {
        const located: string | null = walkUpForMarker(dir)
        if (located) return located
    }
    throw new Error(`findRepoRoot: cannot locate ${REPO_ROOT_MARKER} starting from ${startDir} or ${process.cwd()}`)
}

function walkUpForMarker(start: string): string | null {
    let current: string = start
    while (current !== dirname(current)) {
        if (existsSync(join(current, REPO_ROOT_MARKER))) return current
        current = dirname(current)
    }
    return null
}
