/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import * as O from 'fp-ts/lib/Option.js'
import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeEnv} from '../runtime-config'
import {getRuntimeProjectRoot, getRuntimeVaultPaths, getRuntimeWritePath} from '../graph-bridge'
import path from 'path'

type SelectEnvVarValueIndex = (values: readonly string[]) => number

export async function buildTerminalEnvVars(params: {
    readonly contextNodePath: string
    readonly taskNodePath: string
    readonly terminalId: string
    readonly agentName: string
    readonly settings: VTSettings
    readonly promptTemplate?: string
    readonly envOverrides?: Record<string, string>
}, selectEnvVarValueIndex: SelectEnvVarValueIndex = (values: readonly string[]) => Math.floor(Math.random() * values.length)): Promise<Record<string, string>> {
    const resolvedEnvVars: Record<string, string> = resolveEnvVarsWithSelection(
        params.settings.INJECT_ENV_VARS,
        selectEnvVarValueIndex
    )

    if (params.promptTemplate && resolvedEnvVars[params.promptTemplate]) {
        resolvedEnvVars['AGENT_PROMPT'] = resolvedEnvVars[params.promptTemplate]
    }
    const env = getRuntimeEnv()
    const appSupportPath: string = env.getAppSupportPath()
    const allVaultPaths: readonly string[] = env.getVaultPaths
        ? await env.getVaultPaths()
        : await getRuntimeVaultPaths()
    const allMarkdownReadPaths: string = allVaultPaths.join('\n')
    const vaultPath: string = env.getWritePath
        ? (await env.getWritePath()) ?? ''
        : O.getOrElse(() => '')(await getRuntimeWritePath())

    const projectRoot: string | null = env.getProjectRootWatchedDirectory
        ? env.getProjectRootWatchedDirectory()
        : getRuntimeProjectRoot()
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
