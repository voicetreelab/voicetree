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
 *
 * @returns { success: true } if lock acquired, { success: false, error: string } if folder is locked by another instance
 */
export async function acquireFolderLock(folderPath: string): Promise<{ success: true } | { success: false; error: string }> {
    const lockPath: string = path.join(folderPath, LOCK_FILENAME)

    try {
        // Check if lock file exists
        const lockContent: string | null = await fs.readFile(lockPath, 'utf-8').catch(() => null)

        if (lockContent !== null) {
            const pid: number = parseInt(lockContent.trim(), 10)

            if (!isNaN(pid) && isPidRunning(pid)) {
                // Lock is held by a running process
                return {
                    success: false,
                    error: `Another instance of VoiceTree is already running in this folder (PID: ${pid})`
                }
            }

            // Stale lock from crashed process - remove it
            console.log(`[folder-lock] Removing stale lock from PID ${pid}`)
            await fs.unlink(lockPath).catch(() => {})
        }

        // Write our PID to the lock file
        await fs.writeFile(lockPath, process.pid.toString(), 'utf-8')
        currentLockPath = lockPath
        console.log(`[folder-lock] Acquired lock for ${folderPath} (PID: ${process.pid})`)

        return { success: true }
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: `Failed to acquire folder lock: ${errorMessage}` }
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
