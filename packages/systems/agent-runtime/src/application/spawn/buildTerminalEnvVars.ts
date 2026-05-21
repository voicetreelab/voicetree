/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import * as O from 'fp-ts/lib/Option.js'
import {readFile} from 'node:fs/promises'
import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getRuntimeProjectRoot, getRuntimeVaultPaths, getRuntimeWritePath} from '../runtime/graph-bridge'
import {appendCliManualToAgentPrompt, readCliManualOrNull} from './cliManualInjection'
import path from 'path'

/**
 * Read the hook HTTP port the daemon published to
 * `<vault>/.voicetree/hook.port`. Returns null when the file is missing or
 * malformed — the env var is then omitted from the spawn env, the curl-based
 * hook delivery silently fails (fire-and-forget), and the agent runs without
 * lifecycle hooks. Design doc §3.4.
 */
async function readHookPort(voicetreeProjectDir: string): Promise<number | null> {
    if (!voicetreeProjectDir) return null
    try {
        const text: string = await readFile(path.join(voicetreeProjectDir, 'hook.port'), 'utf8')
        const port: number = Number.parseInt(text.trim(), 10)
        return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
    } catch {
        return null
    }
}

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
    const hookPort: number | null = await readHookPort(voicetreeProjectDir)

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
        ...(hookPort !== null ? {VOICETREE_HOOK_PORT: String(hookPort)} : {}),
        ...resolvedEnvVars,
        ...(params.envOverrides ?? {}),
    }
    const expanded: Record<string, string> = expandEnvVarsInValues(unexpandedEnvVars)
    const cliManual: string | null = await readCliManualOrNull()
    return appendCliManualToAgentPrompt(expanded, cliManual)
}
