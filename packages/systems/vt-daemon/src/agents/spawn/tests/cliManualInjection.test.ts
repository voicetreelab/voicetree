/**
 * Black-box tests for the spawn-time CLI-manual injection.
 *
 * Two surfaces are covered:
 *
 *   - `appendCliManualToAgentPrompt` — pure: takes env-var map + manual
 *     contents, returns a new env-var map with the manual spliced into
 *     `AGENT_PROMPT`. Idempotent, null-safe.
 *
 *   - `buildTerminalEnvVars` end-to-end — the public path that the spawn
 *     pipeline takes. We point the runtime env at a temp manual file and
 *     assert the produced `AGENT_PROMPT` contains the manual contents
 *     verbatim. No internal mocks: the runtime env is configured normally
 *     and the file is real.
 */

import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {configureAgentRuntime} from '@vt/vt-daemon/runtime/runtime-config.ts'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'
import {appendCliManualToAgentPrompt} from '../cliManualInjection'

describe('appendCliManualToAgentPrompt (pure)', () => {
    it('appends the manual inside <vt_cli_manual> sentinels', () => {
        const result = appendCliManualToAgentPrompt(
            {AGENT_PROMPT: 'Do the work.'},
            '# vt CLI\nUse `vt agent spawn`.',
        )
        expect(result.AGENT_PROMPT).toContain('Do the work.')
        expect(result.AGENT_PROMPT).toContain('<vt_cli_manual>')
        expect(result.AGENT_PROMPT).toContain('Use `vt agent spawn`.')
        expect(result.AGENT_PROMPT).toContain('</vt_cli_manual>')
    })

    it('is idempotent — repeat calls do not stack the section', () => {
        const initial = appendCliManualToAgentPrompt(
            {AGENT_PROMPT: 'Base.'},
            'MANUAL_BODY',
        )
        const repeated = appendCliManualToAgentPrompt(initial, 'MANUAL_BODY')
        const count: number = (repeated.AGENT_PROMPT.match(/<vt_cli_manual>/g) ?? []).length
        expect(count).toBe(1)
    })

    it('passes through unchanged when manual is null', () => {
        const input = {AGENT_PROMPT: 'unchanged', OTHER: 'value'}
        expect(appendCliManualToAgentPrompt(input, null)).toEqual(input)
    })

    it('passes through unchanged when manual is empty / whitespace', () => {
        const input = {AGENT_PROMPT: 'unchanged'}
        expect(appendCliManualToAgentPrompt(input, '')).toEqual(input)
        expect(appendCliManualToAgentPrompt(input, '   \n  ')).toEqual(input)
    })

    it('handles an absent AGENT_PROMPT key by starting fresh', () => {
        const result = appendCliManualToAgentPrompt({OTHER: 'x'}, 'MANUAL')
        expect(result.OTHER).toBe('x')
        expect(result.AGENT_PROMPT).toContain('<vt_cli_manual>')
        expect(result.AGENT_PROMPT).toContain('MANUAL')
    })

    it('injects only the Essentials block when markers are present', () => {
        const manual: string = [
            '# vt CLI Manual',
            '',
            'Preamble that should be excluded.',
            '',
            '<!-- BEGIN_ESSENTIALS -->',
            '## Essentials',
            '',
            '### `vt agent spawn`',
            '',
            'Spawn an agent.',
            '<!-- END_ESSENTIALS -->',
            '',
            '## Reference',
            '',
            '### `vt graph structure`',
            '',
            'Render the graph.',
            '',
        ].join('\n')

        const result = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Base.'}, manual)

        expect(result.AGENT_PROMPT).toContain('## Essentials')
        expect(result.AGENT_PROMPT).toContain('`vt agent spawn`')
        expect(result.AGENT_PROMPT).not.toContain('Preamble that should be excluded.')
        expect(result.AGENT_PROMPT).not.toContain('## Reference')
        expect(result.AGENT_PROMPT).not.toContain('`vt graph structure`')
        expect(result.AGENT_PROMPT).not.toContain('BEGIN_ESSENTIALS')
        expect(result.AGENT_PROMPT).not.toContain('END_ESSENTIALS')
    })

    it('falls back to the full manual when markers are absent', () => {
        const manual: string = '# vt CLI Manual\n\n### `vt agent spawn`\n\nSpawn an agent.\n'
        const result = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Base.'}, manual)

        expect(result.AGENT_PROMPT).toContain('# vt CLI Manual')
        expect(result.AGENT_PROMPT).toContain('`vt agent spawn`')
        expect(result.AGENT_PROMPT).toContain('Spawn an agent.')
    })

    it('falls back to the full manual when only the BEGIN marker is present', () => {
        const manual: string = '# vt CLI Manual\n<!-- BEGIN_ESSENTIALS -->\n## Essentials\n\nbody\n'
        const result = appendCliManualToAgentPrompt({AGENT_PROMPT: 'Base.'}, manual)

        // Without an END marker we can't trust the boundary — inject everything.
        expect(result.AGENT_PROMPT).toContain('# vt CLI Manual')
        expect(result.AGENT_PROMPT).toContain('## Essentials')
    })
})

describe('buildTerminalEnvVars — CLI manual injection end-to-end', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-cli-manual-spawn-'))
    })

    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
        configureAgentRuntime({})
    })

    it('injects the CLI manual content into AGENT_PROMPT', async () => {
        const manualPath: string = path.join(tempDir, 'cli-manual.md')
        const manualBody: string = '# vt CLI Manual\n\n`vt agent spawn` — spawn an agent.\n'
        await fs.writeFile(manualPath, manualBody, 'utf-8')

        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolder: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
                getCliManualPath: (): string => manualPath,
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
        expect(envVars.AGENT_PROMPT).toContain('`vt agent spawn` — spawn an agent.')
        expect(envVars.AGENT_PROMPT).toContain('</vt_cli_manual>')
    })

    it('falls through unchanged when the manual file is missing', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolder: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
                getCliManualPath: (): string => path.join(tempDir, 'missing-manual.md'),
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {AGENT_PROMPT: 'base prompt'},
            } as never,
        })

        expect(envVars.AGENT_PROMPT).toBe('base prompt')
        expect(envVars.AGENT_PROMPT).not.toContain('<vt_cli_manual>')
    })

    it('skips injection when getCliManualPath is not registered', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
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
                INJECT_ENV_VARS: {AGENT_PROMPT: 'base prompt'},
            } as never,
        })

        expect(envVars.AGENT_PROMPT).toBe('base prompt')
    })
})
