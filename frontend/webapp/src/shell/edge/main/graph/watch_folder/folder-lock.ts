/**
 * Folder lock mechanism for VoiceTree.
 *
 * Uses a .voicetree.lock file containing the PID of the owning process.
 * Overwrites any existing lock (which may be stale from a crash).
 */

import path from 'path'
import { promises as fs } from 'fs'

const LOCK_FILENAME: string = '.voicetree.lock'

/** Currently held lock path (for cleanup on quit) */
let currentLockPath: string | null = null

/**
 * Try to acquire a lock for the given folder.
 * Always acquires the lock, overwriting any existing lock (which may be stale from a crash).
 *
 * @returns { success: true } - always succeeds
 */
export async function acquireFolderLock(folderPath: string): Promise<{ success: true }> {
    const lockPath: string = path.join(folderPath, LOCK_FILENAME)

    try {
        // Remove any existing lock (may be stale from a crash)
        await fs.unlink(lockPath).catch(() => {})

        // Write our PID to the lock file
        await fs.writeFile(lockPath, process.pid.toString(), 'utf-8')
        currentLockPath = lockPath
        console.log(`[folder-lock] Acquired lock for ${folderPath} (PID: ${process.pid})`)
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        console.error(`[folder-lock] Failed to acquire lock: ${errorMessage}`)
        // Continue anyway - lock is best-effort, don't block the user
    }

    return { success: true }
}

/**
 * Release the lock for the given folder.
 * Only releases if we own the lock (our PID is in the file).
 */
export async function releaseFolderLock(folderPath: string): Promise<void> {
    const lockPath: string = path.join(folderPath, LOCK_FILENAME)

    try {
        const lockContent: string | null = await fs.readFile(lockPath, 'utf-8').catch(() => null)

        if (lockContent !== null) {
            const pid: number = parseInt(lockContent.trim(), 10)

            // Only release if we own it
            if (pid === process.pid) {
                await fs.unlink(lockPath)
                console.log(`[folder-lock] Released lock for ${folderPath}`)
            }
        }
    } catch (error) {
        console.error(`[folder-lock] Error releasing lock:`, error)
    }

    if (currentLockPath === lockPath) {
        currentLockPath = null
    }
}

/**
 * Release the current lock (if any).
 * Called on app quit to clean up.
 */
export async function releaseCurrentLock(): Promise<void> {
    if (currentLockPath !== null) {
        const folderPath: string = path.dirname(currentLockPath)
        await releaseFolderLock(folderPath)
    }
}

/**
 * Get the path of the currently held lock (for testing/debugging).
 */
export function getCurrentLockPath(): string | null {
    return currentLockPath
}
