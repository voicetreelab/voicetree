/**
 * Read the hook HTTP port the daemon published to
 * `<vault>/.voicetree/hook.port`. Returns null when the file is missing or
 * malformed — callers omit `VOICETREE_HOOK_PORT` from spawn envs (Claude's
 * hook curls then no-op against the unset var) and skip Codex hook-flag
 * injection. Design doc §3.4.
 *
 * Single source of truth: both `buildTerminalEnvVars` (to set the env var)
 * and `terminalData.prepareTerminalDataInMain` (to bake the port into Codex
 * hook flags) call this so they stay in agreement.
 */

import {readFile} from 'node:fs/promises'
import path from 'node:path'

export async function readHookPortFromVault(voicetreeProjectDir: string): Promise<number | null> {
    if (!voicetreeProjectDir) return null
    try {
        const text: string = await readFile(path.join(voicetreeProjectDir, 'hook.port'), 'utf8')
        const port: number = Number.parseInt(text.trim(), 10)
        return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
    } catch {
        return null
    }
}
