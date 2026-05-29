/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getProjectDotVoicetreePath, resolveVoicetreeHomePath} from '@vt/app-config/paths'
import {getRuntimeProjectRoot, getRuntimeVaultPaths} from '../runtime/graph-bridge'
import {appendCliManualToAgentPrompt} from './cliManualInjection'
import {prependVtBinToPath, readVtBinDirOrNull} from './vtPathInjection'
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
    const voicetreeHomePath: string = resolveVoicetreeHomePath()
    const allVaultPaths: readonly string[] = env.getVaultPaths
        ? await env.getVaultPaths()
        : await getRuntimeVaultPaths()
    const allMarkdownReadPaths: string = allVaultPaths.join('\n')

    // VOICETREE_VAULT_PATH points at the canonical vault root (where `.voicetree/` lives),
    // not the daemon's current writeFolder. Many consumers — the CLI's auth-token resolver
    // (vt-rpc#authTokenFilePath), the agent hook script template
    // (agentHookInjection.ts), tmuxPromptFile, the tmux namespace builder — all read
    // `$VOICETREE_VAULT_PATH/.voicetree/...`. Pointing the var at a subfolder writeFolder
    // creates stub `.voicetree/` dirs that break the CLI up-walk and the hook script.
    const projectRoot: string | null = env.getProjectRoot
        ? await env.getProjectRoot()
        : await getRuntimeProjectRoot()
    const voicetreeProjectDir: string = projectRoot ? getProjectDotVoicetreePath(projectRoot) : ''
    const daemonPort: number | null = await readDaemonPortFromVault(voicetreeProjectDir)
    const daemonUrl: string | null = daemonPort !== null ? `http://127.0.0.1:${daemonPort}` : null

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_PROJECT_DIR: voicetreeProjectDir,
        VOICETREE_HOME_PATH: voicetreeHomePath ?? '',
        VOICETREE_VAULT_PATH: projectRoot ?? '',
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
    const withManual: Record<string, string> = appendCliManualToAgentPrompt(filtered)
    const vtBinDir: string | null = await readVtBinDirOrNull()
    return prependVtBinToPath(withManual, vtBinDir)
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
