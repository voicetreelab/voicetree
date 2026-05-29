/**
 * Black-box tests for the spawn-time CLI-manual injection.
 *
 * Two surfaces are covered:
 *
 *   - `appendCliManualToAgentPrompt` — pure: takes an env-var map and
 *     returns a new map with the essentials slice of the manual
 *     spliced into `AGENT_PROMPT`. Idempotent. Sources the manual from
 *     `TOOL_SPECS` — no file read.
 *
 *   - `buildTerminalEnvVars` end-to-end — the public path the spawn
 *     pipeline takes. The produced `AGENT_PROMPT` should contain the
 *     manual essentials regardless of any runtime env configuration.
 *     No internal mocks; no fixture filesystem.
 */

import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'
import {appendCliManualToAgentPrompt} from '../cliManualInjection'

describe('appendCliManualToAgentPrompt (pure)', () => {
    it('appends the manual inside <vt_cli_manual> sentinels', () => {
        const result: Record<string, string> = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Do the work.'})
        expect(result.AGENT_PROMPT).toContain('Do the work.')
        expect(result.AGENT_PROMPT).toContain('<vt_cli_manual>')
        expect(result.AGENT_PROMPT).toContain('vt agent spawn')
        expect(result.AGENT_PROMPT).toContain('</vt_cli_manual>')
    })

    it('is idempotent — repeat calls do not stack the section', () => {
        const initial: Record<string, string> = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Base.'})
        const repeated: Record<string, string> = appendCliManualToAgentPrompt(initial)
        const count: number = (repeated.AGENT_PROMPT.match(/<vt_cli_manual>/g) ?? []).length
        expect(count).toBe(1)
    })

    it('handles an absent AGENT_PROMPT key by starting fresh', () => {
        const result: Record<string, string> = appendCliManualToAgentPrompt({OTHER: 'x'})
        expect(result.OTHER).toBe('x')
        expect(result.AGENT_PROMPT).toContain('<vt_cli_manual>')
        expect(result.AGENT_PROMPT).toContain('vt agent spawn')
    })

    it('injects only the essentials slice — reference verbs are absent', () => {
        const result: Record<string, string> = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Base.'})

        // Essentials per tool-specs.ts canonical tiering.
        expect(result.AGENT_PROMPT).toContain('vt agent spawn')
        expect(result.AGENT_PROMPT).toContain('vt graph create')
        expect(result.AGENT_PROMPT).toContain('vt graph unseen')

        // Reference-tier verbs must NOT appear in the injected slice.
        expect(result.AGENT_PROMPT).not.toContain('vt agent close')
        expect(result.AGENT_PROMPT).not.toContain('vt agent send')
        expect(result.AGENT_PROMPT).not.toContain('vt agent output')
        expect(result.AGENT_PROMPT).not.toContain('vt search')
        expect(result.AGENT_PROMPT).not.toContain('vt graph live')

        // The injected slice should not advertise its own tier headers.
        expect(result.AGENT_PROMPT).not.toContain('## Essentials')
        expect(result.AGENT_PROMPT).not.toContain('## Reference')
    })
})

describe('buildTerminalEnvVars — CLI manual injection end-to-end', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'vt-cli-manual-spawn-'))
        process.env.VOICETREE_APP_SUPPORT = tempDir
    })

    afterEach(async () => {
        await rm(tempDir, {recursive: true, force: true})
        configureAgentRuntime({})
        delete process.env.VOICETREE_APP_SUPPORT
    })

    it('always injects the CLI manual content into AGENT_PROMPT', async () => {
        configureAgentRuntime({
            env: {
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolder: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {AGENT_PROMPT: 'Do the work at $CONTEXT_NODE_PATH.'},
            } as never,
        })

        expect(envVars.AGENT_PROMPT).toContain('Do the work at /ctx.')
        expect(envVars.AGENT_PROMPT).toContain('<vt_cli_manual>')
        expect(envVars.AGENT_PROMPT).toContain('vt agent spawn')
        expect(envVars.AGENT_PROMPT).toContain('</vt_cli_manual>')
    })
})
