/// <reference types="node" />
import fs from 'fs';
import os from 'os';

/**
 * Validate that the process CWD is accessible at startup.
 * If not, fall back to the user's home directory to prevent
 * spawn ENOTDIR errors in child processes.
 */
export function validateStartupCwd(): void {
    const startupCwd: string = process.cwd();

    try {
        fs.accessSync(startupCwd, fs.constants.R_OK);
    } catch (cwdError: unknown) {
        const errorMessage: string = cwdError instanceof Error ? cwdError.message : String(cwdError);
        console.error(`[Startup] WARNING: cwd is INVALID - ${errorMessage}`);
        // Change to a known-good directory to prevent spawn ENOTDIR errors
        // Use os.homedir() as fallback
        const fallbackCwd: string = os.homedir();
        try {
            process.chdir(fallbackCwd);
        } catch (chdirError: unknown) {
            const chdirErrorMessage: string = chdirError instanceof Error ? chdirError.message : String(chdirError);
            console.error(`[Startup] Failed to change to fallback cwd: ${chdirErrorMessage}`);
        }
    }
}
