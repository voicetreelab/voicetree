/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import * as O from 'fp-ts/lib/Option.js'
import {resolveEnvVars, expandEnvVarsInValues} from '@/pure/settings'
import type {VTSettings} from '@/pure/settings/types'
import {getAppSupportPath} from '@/shell/edge/main/state/app-electron-state'
import {getVaultPaths, getWritePath} from '@/shell/edge/main/graph/watch_folder/vault-allowlist'
import {getMcpPort} from '@/shell/edge/main/mcp-server/mcp-server'

export async function buildTerminalEnvVars(params: {
    readonly contextNodePath: string
    readonly taskNodePath: string
    readonly terminalId: string
    readonly agentName: string
    readonly settings: VTSettings
    readonly promptTemplate?: string
}): Promise<Record<string, string>> {
    const resolvedEnvVars: Record<string, string> = resolveEnvVars(params.settings.INJECT_ENV_VARS)

    if (params.promptTemplate && resolvedEnvVars[params.promptTemplate]) {
        resolvedEnvVars['AGENT_PROMPT'] = resolvedEnvVars[params.promptTemplate]
    }
    const appSupportPath: string = getAppSupportPath()
    const allVaultPaths: readonly string[] = await getVaultPaths()
    const allMarkdownReadPaths: string = allVaultPaths.join('\n')
    const vaultPath: string = O.getOrElse(() => '')(await getWritePath())

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_APP_SUPPORT: appSupportPath ?? '',
        VOICETREE_VAULT_PATH: vaultPath,
        ALL_MARKDOWN_READ_PATHS: allMarkdownReadPaths,
        CONTEXT_NODE_PATH: params.contextNodePath,
        TASK_NODE_PATH: params.taskNodePath,
        VOICETREE_TERMINAL_ID: params.terminalId,
        VOICETREE_CALLER_TERMINAL_ID: params.terminalId,
        AGENT_NAME: params.agentName,
        VOICETREE_MCP_PORT: String(getMcpPort()),
        ...resolvedEnvVars,
    }
    return expandEnvVarsInValues(unexpandedEnvVars)
}
