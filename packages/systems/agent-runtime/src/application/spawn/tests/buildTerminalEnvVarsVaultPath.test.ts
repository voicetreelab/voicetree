/**
 * Regression test for the VOICETREE_VAULT_PATH semantics.
 *
 * The exported VOICETREE_VAULT_PATH must point at the canonical vault root
 * (the directory containing `.voicetree/`), NOT the daemon's current
 * writeFolder. Many downstream consumers — vt-rpc's `authTokenFilePath`,
 * the agent hook script template (`agentHookInjection`), tmuxPromptFile,
 * the tmux namespace builder — all read `$VOICETREE_VAULT_PATH/.voicetree/...`.
 * Pointing the var at a subfolder writeFolder breaks every one of them.
 *
 * Black-box: configure the runtime env normally (no internal mocks), call
 * `buildTerminalEnvVars`, assert on the produced env vector.
 */

import {afterEach, describe, expect, it} from 'vitest'
import {configureAgentRuntime} from '../../runtime/runtime-config'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'

const CANONICAL_ROOT = '/Users/x/voicetree/brain/workflows/forecasting'
const SUBFOLDER_WRITE_FOLDER = '/Users/x/voicetree/brain/workflows/forecasting/voicetree-23-5'
const CONTEXT_NODE_PATH = `${SUBFOLDER_WRITE_FOLDER}/ctx-nodes/task_rx33do_context.md`
const TASK_NODE_PATH = `${SUBFOLDER_WRITE_FOLDER}/task_rx33do.md`

describe('buildTerminalEnvVars — vault-path semantics', () => {
    afterEach(() => {
        configureAgentRuntime({})
    })

    it('exports VOICETREE_VAULT_PATH as the canonical project root, not the writeFolder subfolder', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => '/tmp/app-support',
                getVaultPaths: async (): Promise<readonly string[]> => [CANONICAL_ROOT, SUBFOLDER_WRITE_FOLDER],
                getWriteFolder: async (): Promise<string | null> => SUBFOLDER_WRITE_FOLDER,
                getProjectRoot: async (): Promise<string | null> => CANONICAL_ROOT,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: CONTEXT_NODE_PATH,
            taskNodePath: TASK_NODE_PATH,
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {INJECT_ENV_VARS: {}} as never,
        })

        expect(envVars.VOICETREE_VAULT_PATH).toBe(CANONICAL_ROOT)
        expect(envVars.VOICETREE_PROJECT_DIR).toBe(`${CANONICAL_ROOT}/.voicetree`)
    })

    it('keeps CONTEXT_NODE_PATH and TASK_NODE_PATH subfolder-scoped (they encode node identity, not the vault root)', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => '/tmp/app-support',
                getVaultPaths: async (): Promise<readonly string[]> => [CANONICAL_ROOT, SUBFOLDER_WRITE_FOLDER],
                getWriteFolder: async (): Promise<string | null> => SUBFOLDER_WRITE_FOLDER,
                getProjectRoot: async (): Promise<string | null> => CANONICAL_ROOT,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: CONTEXT_NODE_PATH,
            taskNodePath: TASK_NODE_PATH,
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {INJECT_ENV_VARS: {}} as never,
        })

        expect(envVars.CONTEXT_NODE_PATH).toBe(CONTEXT_NODE_PATH)
        expect(envVars.TASK_NODE_PATH).toBe(TASK_NODE_PATH)
    })

    it('exposes both canonical root and subfolder writeFolder under ALL_MARKDOWN_READ_PATHS', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => '/tmp/app-support',
                getVaultPaths: async (): Promise<readonly string[]> => [CANONICAL_ROOT, SUBFOLDER_WRITE_FOLDER],
                getWriteFolder: async (): Promise<string | null> => SUBFOLDER_WRITE_FOLDER,
                getProjectRoot: async (): Promise<string | null> => CANONICAL_ROOT,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: CONTEXT_NODE_PATH,
            taskNodePath: TASK_NODE_PATH,
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {INJECT_ENV_VARS: {}} as never,
        })

        expect(envVars.ALL_MARKDOWN_READ_PATHS.split('\n')).toContain(CANONICAL_ROOT)
        expect(envVars.ALL_MARKDOWN_READ_PATHS.split('\n')).toContain(SUBFOLDER_WRITE_FOLDER)
    })

    it('falls back to empty string when no project root is configured (no daemon attached)', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => '/tmp/app-support',
                getVaultPaths: async (): Promise<readonly string[]> => [],
                getProjectRoot: async (): Promise<string | null> => null,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: CONTEXT_NODE_PATH,
            taskNodePath: TASK_NODE_PATH,
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {INJECT_ENV_VARS: {}} as never,
        })

        expect(envVars.VOICETREE_VAULT_PATH).toBe('')
        expect(envVars.VOICETREE_PROJECT_DIR).toBe('')
    })
})
