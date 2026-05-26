/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import * as O from 'fp-ts/lib/Option.js'
import {resolveEnvVarsWithSelection, expandEnvVarsInValues} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {getRuntimeProjectRoot, getRuntimeVaultPaths, getRuntimeWriteFolder} from '../runtime/graph-bridge'
import path from 'path'

type SelectEnvVarValueIndex = (values: readonly string[]) => number
type VaultSnapshot = {
    readonly projectRoot: string | null
    readonly readPaths: readonly string[]
    readonly writeFolder: string | null
}

type VaultEnv = {
    readonly allVaultPaths: readonly string[]
    readonly projectRoot: string | null
    readonly writeFolder: string
}

function selectRandomEnvVarValueIndex(values: readonly string[]): number {
    return Math.floor(Math.random() * values.length)
}

function vaultPathsFromSnapshot(snapshot: VaultSnapshot): readonly string[] {
    return [
        ...(snapshot.writeFolder ? [snapshot.writeFolder] : []),
        ...snapshot.readPaths.filter(path => path !== snapshot.writeFolder),
    ]
}

async function resolveVaultEnv(env: ReturnType<typeof getRuntimeEnv>): Promise<VaultEnv> {
    if (env.getVaultSnapshot) {
        const snapshot: VaultSnapshot = await env.getVaultSnapshot()
        return {
            allVaultPaths: vaultPathsFromSnapshot(snapshot),
            projectRoot: snapshot.projectRoot,
            writeFolder: snapshot.writeFolder ?? '',
        }
    }

    const allVaultPaths: readonly string[] = env.getVaultPaths
        ? await env.getVaultPaths()
        : await getRuntimeVaultPaths()
    const writeFolder: string = env.getWriteFolder
        ? (await env.getWriteFolder()) ?? ''
        : O.getOrElse(() => '')(await getRuntimeWriteFolder())
    const projectRoot: string | null = env.getProjectRoot
        ? await env.getProjectRoot()
        : await getRuntimeProjectRoot()
    return {allVaultPaths, projectRoot, writeFolder}
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
    const {allVaultPaths, projectRoot, writeFolder}: VaultEnv = await resolveVaultEnv(env)
    const allMarkdownReadPaths: string = allVaultPaths.join('\n')
    const voicetreeProjectDir: string = projectRoot ? path.join(projectRoot, '.voicetree') : ''
    const vaultPath: string = writeFolder || projectRoot || ''

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
    return dropPromptTemplateVariants(expandEnvVarsInValues(unexpandedEnvVars))
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
