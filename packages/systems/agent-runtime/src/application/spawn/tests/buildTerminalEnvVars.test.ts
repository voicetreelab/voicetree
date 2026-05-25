import {afterEach, describe, expect, it} from 'vitest'
import type {VTSettings} from '@vt/graph-model/settings'
import {configureAgentRuntime} from '../../runtime/runtime-config'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'

const settings = {
    INJECT_ENV_VARS: {
        AGENT_PROMPT: 'vault=$VOICETREE_VAULT_PATH project=$VOICETREE_PROJECT_DIR all=$ALL_MARKDOWN_READ_PATHS',
    },
} as VTSettings

describe('buildTerminalEnvVars', () => {
    afterEach(() => {
        configureAgentRuntime({})
    })

    it('uses the daemon write folder as VOICETREE_VAULT_PATH while keeping project metadata under the watched root', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: () => '/app-support',
                getProjectRoot: async () => '/watched-project',
                getWriteFolder: async () => '/watched-project/voicetree-25-5',
                getVaultPaths: async () => [
                    '/watched-project/voicetree-25-5',
                    '/watched-project/reference',
                ],
            },
        })

        const env = await buildTerminalEnvVars({
            contextNodePath: '/watched-project/voicetree-25-5/context.md',
            taskNodePath: '/watched-project/voicetree-25-5/task.md',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings,
        })

        expect(env.VOICETREE_PROJECT_DIR).toBe('/watched-project/.voicetree')
        expect(env.VOICETREE_VAULT_PATH).toBe('/watched-project/voicetree-25-5')
        expect(env.ALL_MARKDOWN_READ_PATHS).toBe('/watched-project/voicetree-25-5\n/watched-project/reference')
        expect(env.AGENT_PROMPT).toContain('vault=/watched-project/voicetree-25-5')
        expect(env.AGENT_PROMPT).toContain('project=/watched-project/.voicetree')
    })
})
