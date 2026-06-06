/**
 * Shared env var assembly for terminal spawning.
 * Eliminates duplication across spawnPlainTerminal, spawnHookTerminal, and prepareTerminalDataInMain.
 */

import {resolveEnvVarsWithSelection, expandEnvVarsInValues, appendPersonaToAgentPrompt} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import * as O from 'fp-ts/lib/Option.js'
import {getRuntimeEnv, getGraphBridge} from '../runtime/runtime-config'
import {getProjectDotVoicetreePath, resolveVoicetreeHomePath} from '@vt/paths'
import {getRuntimeProjectRoot, getRuntimeProjectPaths} from '../runtime/graph-bridge'
import {appendCliDiscoveryToAgentPrompt} from './injection/cliManualInjection'
import {prependVtBinToPath, prependHomeBinToPath, readVtBinDirOrNull} from './injection/vtPathInjection'
import {readDaemonPortFromProject} from './daemonUrlFile'
import {promises as fs} from 'fs'
import type {Dirent} from 'fs'
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
    const env = getRuntimeEnv()
    const voicetreeHomePath: string = resolveVoicetreeHomePath()
    const allProjectPaths: readonly string[] = env.getProjectPaths
        ? await env.getProjectPaths()
        : await getRuntimeProjectPaths()
    const allMarkdownReadPaths: string = allProjectPaths.join('\n')

    // VOICETREE_PROJECT_PATH points at the canonical project root (where `.voicetree/` lives),
    // not the daemon's current writeFolderPath. Many consumers — the CLI's auth-token resolver
    // (vt-rpc#authTokenFilePath), tmuxPromptFile, the tmux namespace builder — all read
    // `$VOICETREE_PROJECT_PATH/.voicetree/...`. Pointing the var at a subfolder writeFolderPath
    // creates stub `.voicetree/` dirs that break the CLI up-walk.
    const projectRoot: string | null = env.getProjectRoot
        ? await env.getProjectRoot()
        : await getRuntimeProjectRoot()
    const voicetreeProjectDir: string = projectRoot ? getProjectDotVoicetreePath(projectRoot) : ''
    const writeFolderPath: string | null = env.getWriteFolderPath
        ? await env.getWriteFolderPath()
        : await (async () => {
            const bridge = getGraphBridge()
            if (!bridge) return null
            const o = await bridge.getWriteFolderPath()
            return O.isSome(o) ? (o.value as string) : null
          })()

    // AGENT_PROMPT_* templates are .md files in the single per-machine prompts
    // location ~/.voicetree/prompts (NO per-project prompts dir) — symlinks to the
    // canonical shipped source, kept in sync at daemon/Electron startup. A file is
    // authoritative over any settings value of the same name; persisted settings
    // prune these reserved keys so stale UI values cannot shadow the files.
    // --prompt-template selects which one becomes AGENT_PROMPT.
    const voicetreePromptsDir: string = path.join(voicetreeHomePath, 'prompts')
    const promptTemplates: Record<string, string> = await readPromptTemplates(voicetreePromptsDir)
    const promptVars: Record<string, string> = {...resolvedEnvVars, ...promptTemplates}
    if (params.promptTemplate && promptVars[params.promptTemplate]) {
        promptVars['AGENT_PROMPT'] = promptVars[params.promptTemplate]
    }
    const daemonPort: number | null = await readDaemonPortFromProject(voicetreeProjectDir)
    const daemonUrl: string | null = daemonPort !== null ? `http://127.0.0.1:${daemonPort}` : null

    const unexpandedEnvVars: Record<string, string> = {
        VOICETREE_PROJECT_DIR: voicetreeProjectDir,
        VOICETREE_HOME_PATH: voicetreeHomePath ?? '',
        VOICETREE_PROMPTS_DIR: voicetreePromptsDir,
        VOICETREE_PROJECT_PATH: projectRoot ?? '',
        VOICETREE_WRITE_PATH: writeFolderPath ?? '',
        ALL_MARKDOWN_READ_PATHS: allMarkdownReadPaths,
        CONTEXT_NODE_PATH: params.contextNodePath,
        TASK_NODE_PATH: params.taskNodePath,
        VOICETREE_TERMINAL_ID: params.terminalId,
        VOICETREE_CALLER_TERMINAL_ID: params.terminalId,
        AGENT_NAME: params.agentName,
        // §5.3 — spawn pipeline injects DAEMON_URL (not the token, which
        // consumers read via `cat` from disk to avoid `ps` leak, §3.3).
        // Spawned agents always run inside WSL alongside the daemon, so
        // 127.0.0.1 works in both WSL mirrored and NAT networking modes.
        ...(daemonUrl !== null ? {VOICETREE_DAEMON_URL: daemonUrl} : {}),
        ...promptVars,
        ...(params.envOverrides ?? {}),
    }
    const filtered: Record<string, string> = dropPromptTemplateVariants(expandEnvVarsInValues(unexpandedEnvVars))
    const withCliDiscovery: Record<string, string> = appendCliDiscoveryToAgentPrompt(filtered)
    const withPersona: Record<string, string> = appendPersonaToAgentPrompt(withCliDiscovery, params.agentName, params.settings)
    const vtBinDir: string | null = await readVtBinDirOrNull()
    // $HOME/bin is prepended first so the daemon's vt-bin can sit in front of it.
    // Final order: vtBinDir : $HOME/bin : ...inherited PATH
    const withHomeBin: Record<string, string> = prependHomeBinToPath(withPersona)
    return prependVtBinToPath(withHomeBin, vtBinDir)
}

/**
 * Read the AGENT_PROMPT_* templates (e.g. AGENT_PROMPT_CORE.md,
 * AGENT_PROMPT_LIGHTWEIGHT.md) from the home prompts dir (~/.voicetree/prompts),
 * keyed by filename without the .md suffix. These files are app-controlled
 * symlinks to the shipped source. The single trailing newline added when the
 * files are authored is stripped so the injected value matches the template
 * exactly. Returns {} when the dir is absent (graceful for unprovisioned/test
 * environments).
 */
export async function readPromptTemplates(promptsDir: string): Promise<Record<string, string>> {
    if (!promptsDir) return {}
    let entries: Dirent[]
    try {
        entries = await fs.readdir(promptsDir, {withFileTypes: true})
    } catch {
        return {}
    }
    const templates: Record<string, string> = {}
    for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        if (!entry.name.startsWith('AGENT_PROMPT_') || !entry.name.endsWith('.md')) continue
        const key: string = entry.name.slice(0, -'.md'.length)
        const content: string | null = await fs
            .readFile(path.join(promptsDir, entry.name), 'utf-8')
            .catch(() => null)
        if (content !== null) templates[key] = content.replace(/\n$/, '')
    }
    return templates
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
