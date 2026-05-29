/**
 * Edge helper: writes the static Claude Code hook-settings JSON to the
 * VoiceTree app-support dir on first call, returns the absolute path.
 *
 * Idempotent: the JSON is identical for every spawn, so subsequent calls
 * just confirm the file is on disk. Cheap enough to run per spawn — no
 * caching needed beyond the file system.
 *
 * The path is stable per VoiceTree installation; the hook command inside
 * the JSON references `$VOICETREE_HOOK_PORT` and `$VOICETREE_TERMINAL_ID`
 * which the spawned Claude Code process inherits via buildTerminalEnvVars.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {buildClaudeHookSettingsJson} from './agentHookInjection'

export type ClaudeHookBootstrapDeps = {
    readonly mkdir: (dir: string) => Promise<void>
    readonly readFile: (filePath: string) => Promise<string | null>
    readonly writeFile: (filePath: string, content: string) => Promise<void>
}

async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf8')
    } catch {
        return null
    }
}

const defaultDeps: ClaudeHookBootstrapDeps = {
    mkdir: async (dir: string): Promise<void> => {
        await fs.mkdir(dir, {recursive: true})
    },
    readFile: readFileOrNull,
    writeFile: async (filePath: string, content: string): Promise<void> => {
        await fs.writeFile(filePath, content, 'utf8')
    },
}

/**
 * Ensure the Claude Code hook settings JSON exists at
 * `<voicetreeHomePath>/agent-hooks/claude-code-settings.json` with current content.
 * Returns its absolute path.
 *
 * Rewrites the file if its contents have drifted (e.g. we updated the hook
 * command shape across VoiceTree versions). Same-content writes are skipped.
 */
export async function ensureClaudeHookSettingsFile(
    voicetreeHomePath: string,
    deps: ClaudeHookBootstrapDeps = defaultDeps,
): Promise<string> {
    const dir: string = path.join(voicetreeHomePath, 'agent-hooks')
    const filePath: string = path.join(dir, 'claude-code-settings.json')
    const expected: string = buildClaudeHookSettingsJson()

    const existing: string | null = await deps.readFile(filePath)
    if (existing === expected) return filePath

    await deps.mkdir(dir)
    await deps.writeFile(filePath, expected)
    return filePath
}
