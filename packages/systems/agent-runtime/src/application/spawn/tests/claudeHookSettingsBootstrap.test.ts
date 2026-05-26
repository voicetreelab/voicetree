/**
 * Black-box tests for the bootstrap edge helper.
 *
 * Inputs: an app-support directory path + an in-memory filesystem dep.
 * Outputs (asserted): the returned absolute path and the file write
 * actions captured by the in-memory fs.
 */

import {describe, it, expect, beforeEach} from 'vitest'
import {ensureClaudeHookSettingsFile, type ClaudeHookBootstrapDeps} from '../injection/claudeHookSettingsBootstrap'
import {buildClaudeHookSettingsJson} from '../injection/agentHookInjection'

function makeInMemoryFs(initial: Record<string, string> = {}): {
    deps: ClaudeHookBootstrapDeps
    files: Map<string, string>
    mkdirCalls: string[]
} {
    const files: Map<string, string> = new Map(Object.entries(initial))
    const mkdirCalls: string[] = []
    return {
        files,
        mkdirCalls,
        deps: {
            mkdir: async (dir: string): Promise<void> => {
                mkdirCalls.push(dir)
            },
            readFile: async (filePath: string): Promise<string | null> => files.get(filePath) ?? null,
            writeFile: async (filePath: string, content: string): Promise<void> => {
                files.set(filePath, content)
            },
        },
    }
}

describe('ensureClaudeHookSettingsFile', () => {
    const APP_SUPPORT = '/test/app-support'
    const EXPECTED_PATH = '/test/app-support/agent-hooks/claude-code-settings.json'

    let fs: ReturnType<typeof makeInMemoryFs>

    beforeEach(() => {
        fs = makeInMemoryFs()
    })

    it('writes the settings JSON on first run and returns the absolute path', async () => {
        const result = await ensureClaudeHookSettingsFile(APP_SUPPORT, fs.deps)
        expect(result).toBe(EXPECTED_PATH)
        expect(fs.files.get(EXPECTED_PATH)).toBe(buildClaudeHookSettingsJson())
        expect(fs.mkdirCalls).toEqual(['/test/app-support/agent-hooks'])
    })

    it('idempotent — second call with same content does not rewrite or mkdir', async () => {
        await ensureClaudeHookSettingsFile(APP_SUPPORT, fs.deps)
        fs.mkdirCalls.length = 0
        const writesBefore = fs.files.size
        const result = await ensureClaudeHookSettingsFile(APP_SUPPORT, fs.deps)
        expect(result).toBe(EXPECTED_PATH)
        expect(fs.mkdirCalls).toEqual([]) // no mkdir
        expect(fs.files.size).toBe(writesBefore)
    })

    it('rewrites the file if existing content has drifted from current spec', async () => {
        // Simulate a stale file from a previous VoiceTree version.
        fs = makeInMemoryFs({[EXPECTED_PATH]: '{"hooks": {"OldEvent": "stale"}}\n'})
        const result = await ensureClaudeHookSettingsFile(APP_SUPPORT, fs.deps)
        expect(result).toBe(EXPECTED_PATH)
        expect(fs.files.get(EXPECTED_PATH)).toBe(buildClaudeHookSettingsJson())
        expect(fs.mkdirCalls).toEqual(['/test/app-support/agent-hooks'])
    })

    it('produces a path under the agent-hooks subdir', async () => {
        const result = await ensureClaudeHookSettingsFile('/foo', fs.deps)
        expect(result).toBe('/foo/agent-hooks/claude-code-settings.json')
    })
})
