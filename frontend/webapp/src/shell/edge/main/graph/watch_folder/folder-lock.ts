/**
 * Folder lock mechanism to prevent multiple VoiceTree instances from opening the same folder.
 *
 * Uses a .voicetree.lock file containing the PID of the owning process.
 * Handles stale locks from crashed processes by checking if the PID is still running.
 */

import path from 'path'
import { promises as fs } from 'fs'

const LOCK_FILENAME: string = '.voicetree.lock'

/** Currently held lock path (for cleanup on quit) */
let currentLockPath: string | null = null

/**
 * Check if a process with the given PID is still running.
 */
function isPidRunning(pid: number): boolean {
    try {
        // Signal 0 doesn't kill - just checks if process exists
        process.kill(pid, 0)
        return true
    } catch {
        // ESRCH = process doesn't exist, EPERM = exists but no permission (still running)
        return false
    }
}

/**
 * Try to acquire a lock for the given folder.
 * Always acquires the lock, but returns a warning if another process may be using the folder.
 *
 * @returns { success: true, warning?: string } - always succeeds, warning present if potential conflict detected
 */
export async function acquireFolderLock(folderPath: string): Promise<{ success: true; warning?: string }> {
    const lockPath: string = path.join(folderPath, LOCK_FILENAME)
    let warning: string | undefined

    try {
        // Check if lock file exists
        const lockContent: string | null = await fs.readFile(lockPath, 'utf-8').catch(() => null)

        if (lockContent !== null) {
            const pid: number = parseInt(lockContent.trim(), 10)

            if (!isNaN(pid) && isPidRunning(pid)) {
                // Lock is held by a running process - warn but continue
                warning = `Another process may be using this folder (PID: ${pid}). This could be another VoiceTree instance or a stale lock from a crashed process.`
                console.warn(`[folder-lock] ${warning}`)
            } else {
                // Stale lock from crashed process - remove it
                console.log(`[folder-lock] Removing stale lock from PID ${pid}`)
            }

            await fs.unlink(lockPath).catch(() => {})
        }

        // Write our PID to the lock file
        await fs.writeFile(lockPath, process.pid.toString(), 'utf-8')
        currentLockPath = lockPath
        console.log(`[folder-lock] Acquired lock for ${folderPath} (PID: ${process.pid})`)

        return { success: true, warning }
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        console.error(`[folder-lock] Failed to acquire lock: ${errorMessage}`)
        // Still return success - lock is best-effort, don't block the user
        return { success: true, warning: `Could not create lock file: ${errorMessage}` }
    }
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
