/**
 * Black-box tests for the spawn-time CLI-discovery injection.
 *
 * Two surfaces are covered:
 *
 *   - `appendCliDiscoveryToAgentPrompt` — pure: takes an env-var map and
 *     returns a new map with a concise progressive-retrieval `vt` CLI
 *     pointer spliced into `AGENT_PROMPT`. Idempotent. Sources the
 *     command list from `TOOL_SPECS` — no file read.
 *
 *   - `buildTerminalEnvVars` end-to-end — the public path the spawn
 *     pipeline takes. Custom prompts should get CLI discovery, while
 *     default prompts that already include <VT_CLI> should not duplicate it.
 *     No internal mocks; no fixture filesystem.
 */

import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'
import {appendCliDiscoveryToAgentPrompt} from '../injection/cliManualInjection'

describe('appendCliDiscoveryToAgentPrompt (pure)', () => {
    it('appends concise CLI discovery inside <VT_CLI> sentinels', () => {
        const result: Record<string, string> = appendCliDiscoveryToAgentPrompt({AGENT_PROMPT: 'Do the work.'})
        expect(result.AGENT_PROMPT).toContain('Do the work.')
        expect(result.AGENT_PROMPT).toContain('<VT_CLI>')
        expect(result.AGENT_PROMPT).toContain('vt manual <verb>')
        expect(result.AGENT_PROMPT).toContain('vt agent spawn')
        expect(result.AGENT_PROMPT).toContain('</VT_CLI>')
        expect(result.AGENT_PROMPT).not.toContain('**Parameters:**')
    })

    it('is idempotent — repeat calls do not stack the section', () => {
        const initial: Record<string, string> = appendCliDiscoveryToAgentPrompt({AGENT_PROMPT: 'Base.'})
        const repeated: Record<string, string> = appendCliDiscoveryToAgentPrompt(initial)
        const count: number = (repeated.AGENT_PROMPT.match(/<VT_CLI>/g) ?? []).length
        expect(count).toBe(1)
    })

    it('leaves prompts with existing CLI discovery unchanged', () => {
        const prompt = 'Base.\n<VT_CLI>\nalready here\n</VT_CLI>'
        const result: Record<string, string> = appendCliDiscoveryToAgentPrompt({AGENT_PROMPT: prompt})
        expect(result.AGENT_PROMPT).toBe(prompt)
    })

    it('handles an absent AGENT_PROMPT key by starting fresh', () => {
        const result: Record<string, string> = appendCliDiscoveryToAgentPrompt({OTHER: 'x'})
        expect(result.OTHER).toBe('x')
        expect(result.AGENT_PROMPT).toContain('<VT_CLI>')
        expect(result.AGENT_PROMPT).toContain('vt agent spawn')
    })

    it('injects only essential command names and summaries', () => {
        const result: Record<string, string> = appendCliDiscoveryToAgentPrompt({AGENT_PROMPT: 'Base.'})

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

        // The injected slice should not render manual section structure.
        expect(result.AGENT_PROMPT).not.toContain('### `vt agent spawn`')
        expect(result.AGENT_PROMPT).not.toContain('## Essentials')
        expect(result.AGENT_PROMPT).not.toContain('## Reference')
    })
})

describe('buildTerminalEnvVars — CLI discovery injection end-to-end', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'vt-cli-manual-spawn-'))
        process.env.VOICETREE_HOME_PATH = tempDir
    })

    afterEach(async () => {
        await rm(tempDir, {recursive: true, force: true})
        configureAgentRuntime({})
        delete process.env.VOICETREE_HOME_PATH
    })

    it('injects CLI discovery into a custom AGENT_PROMPT', async () => {
        configureAgentRuntime({
            env: {
                getProjectPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolderPath: async (): Promise<string | null> => tempDir,
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
        expect(envVars.AGENT_PROMPT).toContain('<VT_CLI>')
        expect(envVars.AGENT_PROMPT).toContain('vt agent spawn')
        expect(envVars.AGENT_PROMPT).toContain('</VT_CLI>')
    })

    it('does not duplicate CLI discovery when the prompt template already includes <VT_CLI>', async () => {
        configureAgentRuntime({
            env: {
                getProjectPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolderPath: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {AGENT_PROMPT: '<VT_CLI>\nalready concise\n</VT_CLI>'},
            } as never,
        })

        expect(envVars.AGENT_PROMPT.match(/<VT_CLI>/g)).toHaveLength(1)
        expect(envVars.AGENT_PROMPT).toContain('already concise')
        expect(envVars.AGENT_PROMPT).not.toContain('Common verbs:')
    })
})
