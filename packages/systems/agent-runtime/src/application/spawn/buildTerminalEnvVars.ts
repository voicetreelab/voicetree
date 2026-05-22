/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import * as O from 'fp-ts/lib/Option.js'
import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getRuntimeProjectRoot, getRuntimeVaultPaths, getRuntimeWritePath} from '../runtime/graph-bridge'
import {appendCliManualToAgentPrompt, readCliManualOrNull} from './cliManualInjection'
import {readDaemonPortFromVault} from './daemonUrlFile'
import path from 'path'

type SelectEnvVarValueIndex = (values: readonly string[]) => number

function selectRandomEnvVarValueIndex(values: readonly string[]): number {
    return Math.floor(Math.random() * values.length)
}

export async function buildTerminalEnvVars(params: {
    readonly contextNodePath: string
    readonly taskNodePath: string
    readonly terminalId: string
    readonly agentName: string
    readonly settings: VTSettings
    readonly promptTemplate?: string
    readonly envOverrides?: Record<string, string>
}, selectEnvVarValueIndex: SelectEnvVarValueIndex = selectRandomEnvVarValueIndex): Promise<Record<string, string>> {
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
        ? await env.getProjectRootWatchedDirectory()
        : await getRuntimeProjectRoot()
    const voicetreeProjectDir: string = projectRoot ? path.join(projectRoot, '.voicetree') : ''
    const daemonPort: number | null = await readDaemonPortFromVault(voicetreeProjectDir)
    const daemonUrl: string | null = daemonPort !== null ? `http://127.0.0.1:${daemonPort}` : null

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
        // §5.3 — spawn pipeline injects DAEMON_URL (not the token, which the
        // hook subprocess reads via `cat` from disk to avoid `ps` leak, §3.3).
        // Spawned agents always run inside WSL alongside the daemon, so
        // 127.0.0.1 works in both WSL mirrored and NAT networking modes.
        ...(daemonUrl !== null ? {VOICETREE_DAEMON_URL: daemonUrl} : {}),
        ...resolvedEnvVars,
        ...(params.envOverrides ?? {}),
    }
    const filtered: Record<string, string> = dropPromptTemplateVariants(expandEnvVarsInValues(unexpandedEnvVars))
    const cliManual: string | null = await readCliManualOrNull()
    return appendCliManualToAgentPrompt(filtered, cliManual)
}

export function dropPromptTemplateVariants(env: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of Object.keys(env)) {
        if (key === 'AGENT_PROMPT' || key === 'AGENT_PROMPT_FILE') {
            result[key] = env[key]
            continue
        }
        if (key.startsWith('AGENT_PROMPT_')) continue
        result[key] = env[key]
    }
    return result
}
