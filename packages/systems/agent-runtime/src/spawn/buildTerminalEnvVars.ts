/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import {resolveEnvVars, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getProjectRoot} from '@vt/graph-db-client'
import {getRuntimeEnv, getRuntimeGraphDbClient} from '../runtime-config'
import path from 'path'

export async function buildTerminalEnvVars(params: {
    readonly contextNodePath: string
    readonly taskNodePath: string
    readonly terminalId: string
    readonly agentName: string
    readonly settings: VTSettings
    readonly promptTemplate?: string
    readonly envOverrides?: Record<string, string>
}): Promise<Record<string, string>> {
    const resolvedEnvVars: Record<string, string> = resolveEnvVars(params.settings.INJECT_ENV_VARS)

    if (params.promptTemplate && resolvedEnvVars[params.promptTemplate]) {
        resolvedEnvVars['AGENT_PROMPT'] = resolvedEnvVars[params.promptTemplate]
    }
    const env = getRuntimeEnv()
    const graphDbClient = getRuntimeGraphDbClient()
    const appSupportPath: string = env.getAppSupportPath()
    const vaultState = await graphDbClient.getVault()
    const allVaultPaths: readonly string[] = [
        vaultState.writePath,
        ...vaultState.readPaths.filter((readPath: string) => readPath !== vaultState.writePath),
    ]
    const allMarkdownReadPaths: string = allVaultPaths.join('\n')
    const vaultPath: string = vaultState.writePath

    const projectRoot: string | null = (await getProjectRoot(graphDbClient.baseUrl)).projectRoot
    const voicetreeProjectDir: string = projectRoot ? path.join(projectRoot, '.voicetree') : ''

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_PROJECT_DIR: voicetreeProjectDir,
        VOICETREE_APP_SUPPORT: appSupportPath ?? '',
        VOICETREE_VAULT_PATH: vaultPath,
        ALL_MARKDOWN_READ_PATHS: allMarkdownReadPaths,
        CONTEXT_NODE_PATH: params.contextNodePath,
        TASK_NODE_PATH: params.taskNodePath,
        VOICETREE_TERMINAL_ID: params.terminalId,
        VOICETREE_CALLER_TERMINAL_ID: params.terminalId,
        AGENT_NAME: params.agentName,
        VOICETREE_MCP_PORT: String(env.getMcpPort()),
        ...resolvedEnvVars,
        ...(params.envOverrides ?? {}),
    }
    return expandEnvVarsInValues(unexpandedEnvVars)
}
