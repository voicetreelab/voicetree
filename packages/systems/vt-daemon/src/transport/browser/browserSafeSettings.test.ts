import {describe, expect, it} from 'vitest'
import type {VTSettings} from '@vt/graph-model/settings'
import {createDefaultSettings} from '@vt/graph-model/settings'
import {projectBrowserSafeSettings} from './browserSafeSettings.ts'

describe('projectBrowserSafeSettings', () => {
    it('empties INJECT_ENV_VARS and drops hooks/shell (host + secret concerns)', () => {
        const full: VTSettings = {
            ...createDefaultSettings(),
            INJECT_ENV_VARS: {ANTHROPIC_API_KEY: 'sk-secret', AGENT_PROMPT: 'do the thing'},
            hooks: {worktreeCreated: 'rm -rf /'} as VTSettings['hooks'],
            shell: '/bin/zsh',
        }

        const safe = projectBrowserSafeSettings(full)

        expect(safe.INJECT_ENV_VARS).toEqual({})
        expect(safe.hooks).toBeUndefined()
        expect((safe as {shell?: string}).shell).toBeUndefined()
    })

    it('preserves UI-driving non-secret fields verbatim', () => {
        const full: VTSettings = {
            ...createDefaultSettings(),
            agents: [{name: 'Claude Sonnet'}, {name: 'Gemini'}] as unknown as VTSettings['agents'],
            vimMode: true,
            darkMode: true,
            userEmail: 'mail@example.com',
            contextMaxChars: 12345,
        }

        const safe = projectBrowserSafeSettings(full)

        expect(safe.agents.map(a => a.name)).toEqual(['Claude Sonnet', 'Gemini'])
        expect(safe.vimMode).toBe(true)
        expect(safe.darkMode).toBe(true)
        expect(safe.userEmail).toBe('mail@example.com')
        expect(safe.contextMaxChars).toBe(12345)
    })

    it('never carries a secret value through, regardless of key', () => {
        const safe = projectBrowserSafeSettings({
            ...createDefaultSettings(),
            INJECT_ENV_VARS: {SOME_TOKEN: 'leak-me'},
        })
        expect(JSON.stringify(safe)).not.toContain('leak-me')
    })
})
