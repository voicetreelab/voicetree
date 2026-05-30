/**
 * Provisioning of the single per-machine prompts location, `~/.voicetree/prompts`.
 *
 * Agent prompts are *app-controlled*: the canonical (shipped/repo) prompts always
 * win on app/daemon launch. We mirror them into `~/.voicetree/prompts` as symlinks
 * so a new build's edits propagate with no re-copy, and we stash any user-edited
 * real file into a timestamped backup dir rather than honoring it going forward.
 *
 * This is the ONLY runtime location agents read (no per-project `.voicetree/prompts`).
 * Callable from both the standalone `vtd` daemon boot (the headless/eval path that
 * runs no Electron) and Electron startup (which resolves the packaged source via
 * build-config) — hence its home in the daemon package that both depend on.
 */

import {promises as fs} from 'fs'
import type {Dirent} from 'fs'
import path from 'path'

export type PromptSyncResult = {
    /** Filenames of user-overridden real files moved into the backup dir this run. */
    readonly backedUp: readonly string[]
}

/**
 * Format a UTC instant as a filesystem-safe, lexicographically-sortable backup-dir
 * name: `YYYY-MM-DDTHH-MM-SSZ`. Colons are replaced with `-` so the path is
 * Windows-safe; the big-endian layout means lexical sort == chronological.
 * Milliseconds are dropped (one dir per second is the collision granularity the
 * caller's suffix guard then resolves). e.g. `2026-05-30T13-30-59Z`.
 */
export function formatBackupTimestamp(now: Date): string {
    return now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
}

/**
 * Mirror every file in `sourceDir` into `destDir` as a symlink pointing back at the
 * source. Per-entry resolution:
 *  - dest missing            → create the symlink
 *  - dest is a symlink        → repoint at the current source if it drifted
 *  - dest is a REAL FILE      → move it into a fresh backup dir (the shipped prompt
 *                               wins), then create the symlink
 *  - dest is anything else     → leave untouched (defensive; prompt names are files)
 * Dangling symlinks (source file removed/renamed) are pruned. A missing `sourceDir`
 * is a silent no-op — graceful for the packaged build, where this source-tree
 * resolver does not apply and Electron seeds from `resourcesPath/prompts` instead.
 *
 * `backupDirBase` is the timestamped path resolved by the impure caller; the clock
 * never enters this function, keeping it black-box testable. The actual backup dir
 * is created lazily on the first override and collision-guarded against a peer run
 * occupying the same-second path (suffixes `-1`, `-2`, …).
 *
 * Concurrency: idempotent and tolerant of a peer (a second VTD, or Electron startup)
 * mirroring the same `destDir` simultaneously — symlink EEXIST and rename ENOENT
 * races collapse to the intended end state (every entry is a symlink to the source).
 */
export async function mirrorPromptsAsSymlinks(
    sourceDir: string,
    destDir: string,
    backupDirBase: string,
): Promise<PromptSyncResult> {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(sourceDir, {withFileTypes: true})
    } catch {
        return {backedUp: []} // Source dir absent — nothing to mirror.
    }
    await fs.mkdir(destDir, {recursive: true})

    const backedUp: string[] = []
    let backupDir: string | null = null
    const ensureBackupDir = async (): Promise<string> => {
        if (backupDir === null) backupDir = await createFreshBackupDir(backupDirBase)
        return backupDir
    }

    for (const entry of entries) {
        if (!entry.isFile()) continue
        const src: string = path.join(sourceDir, entry.name)
        const dest: string = path.join(destDir, entry.name)
        const existing: Awaited<ReturnType<typeof fs.lstat>> | null = await fs.lstat(dest).catch(() => null)
        if (existing === null) {
            await createSymlinkTolerant(src, dest)
        } else if (existing.isSymbolicLink()) {
            const current: string | null = await fs.readlink(dest).catch(() => null)
            if (current !== src) {
                await fs.rm(dest, {force: true})
                await createSymlinkTolerant(src, dest)
            }
        } else if (existing.isFile()) {
            // Real file = user override. The shipped prompt wins: stash the override,
            // then symlink. We do NOT honor it going forward.
            const dir: string = await ensureBackupDir()
            if (await moveOverrideToBackup(dest, path.join(dir, entry.name))) {
                backedUp.push(entry.name)
            }
            await createSymlinkTolerant(src, dest)
        }
    }

    // Prune dangling symlinks whose source file no longer exists.
    const destEntries: Dirent[] = await fs.readdir(destDir, {withFileTypes: true}).catch(() => [])
    for (const entry of destEntries) {
        if (!entry.isSymbolicLink()) continue
        const dest: string = path.join(destDir, entry.name)
        const targetExists: boolean = await fs.access(dest).then(() => true).catch(() => false)
        if (!targetExists) await fs.rm(dest, {force: true})
    }

    // A peer run may have backed up every override first, leaving us a dir we
    // claimed but never filled. Drop it so empty timestamp dirs don't accumulate.
    if (backupDir !== null && backedUp.length === 0) {
        await fs.rmdir(backupDir).catch(() => undefined)
    }

    return {backedUp}
}

export type EnsureHomePromptsInput = {
    /** Canonical prompts dir (dev: repo `voicetree-cli/prompts`; packaged: `resourcesPath/prompts`). */
    readonly promptsSource: string
    /** The resolved `~/.voicetree` home (always via resolveVoicetreeHomePath so tests isolate). */
    readonly voicetreeHome: string
    /** Injected clock — the timestamp is resolved here in the impure shell, never in the mirror. */
    readonly now: Date
}

/**
 * Provision `~/.voicetree/prompts` from the canonical source, backing up any user
 * override to `~/.voicetree/.backup/prompts/<timestamp>/`. The one runtime prompts
 * location every agent reads. Idempotent; safe on every app/daemon startup.
 */
export async function ensureHomePrompts(input: EnsureHomePromptsInput): Promise<PromptSyncResult> {
    const destDir: string = path.join(input.voicetreeHome, 'prompts')
    const backupDirBase: string = path.join(
        input.voicetreeHome,
        '.backup',
        'prompts',
        formatBackupTimestamp(input.now),
    )
    return mirrorPromptsAsSymlinks(input.promptsSource, destDir, backupDirBase)
}

/** Create the symlink, tolerating a peer process that created the same link first. */
async function createSymlinkTolerant(src: string, dest: string): Promise<void> {
    try {
        await fs.symlink(src, dest)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        // A peer created it concurrently. Repoint only if it isn't already ours.
        const current: string | null = await fs.readlink(dest).catch(() => null)
        if (current !== null && current !== src) {
            await fs.rm(dest, {force: true})
            await fs.symlink(src, dest).catch((e: NodeJS.ErrnoException) => {
                if (e.code !== 'EEXIST') throw e
            })
        }
    }
}

/** Move `from` → `to`; returns false if a peer already moved it (ENOENT). */
async function moveOverrideToBackup(from: string, to: string): Promise<boolean> {
    try {
        await fs.rename(from, to)
        return true
    } catch (err) {
        const code: string | undefined = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return false // Peer already moved/removed it.
        if (code === 'EXDEV') {
            // Backup dir on a different filesystem than the override — copy + unlink.
            await fs.copyFile(from, to)
            await fs.rm(from, {force: true})
            return true
        }
        throw err
    }
}

/**
 * Atomically claim a fresh backup dir, appending `-1`, `-2`, … when a peer run in
 * the same second already holds the base path. Non-recursive `mkdir` on the leaf is
 * the claim primitive (EEXIST == taken); the parent chain is pre-created.
 */
async function createFreshBackupDir(base: string): Promise<string> {
    await fs.mkdir(path.dirname(base), {recursive: true})
    for (let i = 0; i < 1000; i++) {
        const dir: string = i === 0 ? base : `${base}-${i}`
        try {
            await fs.mkdir(dir)
            return dir
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
    }
    throw new Error(`could not allocate a fresh backup dir under ${base}`)
}
