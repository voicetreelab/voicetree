import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'
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

describe('buildTerminalEnvVars prompt templates from ~/.voicetree/prompts', () => {
    let root: string
    let home: string
    let homePromptsDir: string

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bt-'))
        home = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bt-home-'))
        homePromptsDir = path.join(home, 'prompts')
        await fs.mkdir(homePromptsDir, {recursive: true})
        process.env.VOICETREE_HOME_PATH = home
        configureAgentRuntime({
            env: {
                getProjectRoot: async () => root,
                getProjectPaths: async () => [root],
            },
        })
    })

    afterEach(async () => {
        configureAgentRuntime({})
        delete process.env.VOICETREE_HOME_PATH
        await fs.rm(root, {recursive: true, force: true})
        await fs.rm(home, {recursive: true, force: true})
    })

    const spawn = (overrides: {promptTemplate?: string; injectExtra?: Record<string, string>} = {}) =>
        buildTerminalEnvVars({
            contextNodePath: '/ctx.md',
            taskNodePath: '/task.md',
            terminalId: 'Ana',
            agentName: 'Ana',
            promptTemplate: overrides.promptTemplate,
            settings: {
                INJECT_ENV_VARS: {AGENT_PROMPT: '$AGENT_PROMPT_CORE', ...(overrides.injectExtra ?? {})},
            } as VTSettings,
        })

    it('sources AGENT_PROMPT_CORE from the home prompts dir and expands nested vars', async () => {
        await fs.writeFile(path.join(homePromptsDir, 'AGENT_PROMPT_CORE.md'), 'CORE_BODY_TOKEN ctx=$CONTEXT_NODE_PATH\n')

        const env = await spawn()

        expect(env.AGENT_PROMPT).toContain('CORE_BODY_TOKEN ctx=/ctx.md')
        // VOICETREE_PROMPTS_DIR points at the home prompts dir agents read.
        expect(env.VOICETREE_PROMPTS_DIR).toBe(homePromptsDir)
        // The intermediate template var must not leak into the agent's env.
        expect(env.AGENT_PROMPT_CORE).toBeUndefined()
    })

    it('reads from home only — a per-project .voicetree/prompts is never consulted', async () => {
        // A leftover per-project prompts dir must NOT shadow the home source.
        const projectPromptsDir: string = path.join(root, '.voicetree', 'prompts')
        await fs.mkdir(projectPromptsDir, {recursive: true})
        await fs.writeFile(path.join(projectPromptsDir, 'AGENT_PROMPT_CORE.md'), 'FROM_PROJECT_TOKEN\n')
        await fs.writeFile(path.join(homePromptsDir, 'AGENT_PROMPT_CORE.md'), 'FROM_HOME_TOKEN\n')

        const env = await spawn()

        expect(env.AGENT_PROMPT).toContain('FROM_HOME_TOKEN')
        expect(env.AGENT_PROMPT).not.toContain('FROM_PROJECT_TOKEN')
    })

    it('lets a file template override a settings default of the same name', async () => {
        await fs.writeFile(path.join(homePromptsDir, 'AGENT_PROMPT_CORE.md'), 'FROM_FILE_TOKEN\n')

        const env = await spawn({injectExtra: {AGENT_PROMPT_CORE: 'FROM_SETTINGS_TOKEN'}})

        expect(env.AGENT_PROMPT).toContain('FROM_FILE_TOKEN')
        expect(env.AGENT_PROMPT).not.toContain('FROM_SETTINGS_TOKEN')
    })

    it('honors --prompt-template by selecting that file as AGENT_PROMPT', async () => {
        await fs.writeFile(path.join(homePromptsDir, 'AGENT_PROMPT_CORE.md'), 'CORE_BODY_TOKEN\n')
        await fs.writeFile(path.join(homePromptsDir, 'AGENT_PROMPT_LIGHTWEIGHT.md'), 'LIGHT_BODY_TOKEN ctx=$CONTEXT_NODE_PATH\n')

        const env = await spawn({promptTemplate: 'AGENT_PROMPT_LIGHTWEIGHT'})

        expect(env.AGENT_PROMPT).toContain('LIGHT_BODY_TOKEN ctx=/ctx.md')
        expect(env.AGENT_PROMPT).not.toContain('CORE_BODY_TOKEN')
    })
})
