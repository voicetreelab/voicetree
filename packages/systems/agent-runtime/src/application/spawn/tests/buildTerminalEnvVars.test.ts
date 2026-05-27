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
                getMcpPort: () => 4242,
                getVaultSnapshot: async () => ({
                    projectRoot: '/watched-project',
                    readPaths: [
                        '/watched-project/voicetree-25-5',
                        '/watched-project/reference',
                    ],
                    writeFolder: '/watched-project/voicetree-25-5',
                }),
                getProjectRoot: async () => '/watched-project',
                getWriteFolder: async () => '/watched-project/voicetree-25-5',
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

    it('builds vault env from one vault snapshot', async () => {
        let vaultSnapshotReads = 0
        configureAgentRuntime({
            env: {
                getAppSupportPath: () => '/app-support',
                getMcpPort: () => 4242,
                getVaultSnapshot: async () => {
                    vaultSnapshotReads += 1
                    return {
                        projectRoot: '/watched-project',
                        readPaths: [
                            '/watched-project/voicetree-25-5',
                            '/watched-project/reference',
                        ],
                        writeFolder: '/watched-project/voicetree-25-5',
                    }
                },
                getProjectRoot: async () => {
                    throw new Error('getProjectRoot should not be called when vault snapshot exists')
                },
                getWriteFolder: async () => {
                    throw new Error('getWriteFolder should not be called when vault snapshot exists')
                },
            },
        })

        const env = await buildTerminalEnvVars({
            contextNodePath: '/watched-project/voicetree-25-5/context.md',
            taskNodePath: '/watched-project/voicetree-25-5/task.md',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings,
        })

        expect(vaultSnapshotReads).toBe(1)
        expect(env.VOICETREE_PROJECT_DIR).toBe('/watched-project/.voicetree')
        expect(env.VOICETREE_VAULT_PATH).toBe('/watched-project/voicetree-25-5')
        expect(env.ALL_MARKDOWN_READ_PATHS).toBe('/watched-project/voicetree-25-5\n/watched-project/reference')
    })
})
