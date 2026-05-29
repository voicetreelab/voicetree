import {afterEach, describe, expect, it} from 'vitest'
import type {VTSettings} from '@vt/graph-model/settings'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'

const settings = {
    INJECT_ENV_VARS: {
        AGENT_PROMPT: 'project=$VOICETREE_PROJECT_PATH project=$VOICETREE_PROJECT_DIR all=$ALL_MARKDOWN_READ_PATHS',
    },
} as VTSettings

describe('buildTerminalEnvVars', () => {
    afterEach(() => {
        configureAgentRuntime({})
        delete process.env.VOICETREE_HOME_PATH
    })

    it('expands INJECT_ENV_VARS templates against the canonical project root and aggregates project paths', async () => {
        // VOICETREE_PROJECT_PATH points at the canonical project root (the directory
        // containing `.voicetree/`), NOT the daemon's writeFolderPath. See
        // buildTerminalEnvVarsProjectPath.test.ts for the dedicated regression test
        // covering that contract and the rationale (CLI auth-token up-walk, hook
        // script template, tmuxPromptFile, tmux namespace builder).
        process.env.VOICETREE_HOME_PATH = '/voicetree-home'
        configureAgentRuntime({
            env: {
                getProjectRoot: async () => '/watched-project',
                getWriteFolderPath: async () => '/watched-project/voicetree-25-5',
                getProjectPaths: async () => [
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
        expect(env.VOICETREE_PROJECT_PATH).toBe('/watched-project')
        expect(env.ALL_MARKDOWN_READ_PATHS).toBe('/watched-project/voicetree-25-5\n/watched-project/reference')
        expect(env.AGENT_PROMPT).toContain('project=/watched-project')
        expect(env.AGENT_PROMPT).toContain('project=/watched-project/.voicetree')
        expect(env.AGENT_PROMPT).toContain('all=/watched-project/voicetree-25-5\n/watched-project/reference')
    })
})
