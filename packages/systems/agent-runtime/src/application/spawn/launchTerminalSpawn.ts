import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import {getTerminalId} from '../terminals/terminal-registry/types'
import {clearPendingTerminal} from '../terminals/terminal-registry'
import {setTerminalBudget} from '../terminals/global-budget-registry'
import {spawnHeadlessAgent, killHeadlessAgent} from '../headless/headlessAgentManager'
import {getRuntimeUI} from '../runtime/runtime-config'
import {buildHeadlessCommand} from './headlessCli'
import {prepareTerminalDataInMain} from './terminalData'
import type {SpawnTerminalLogger} from './reloadNodeFromDisk'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {VTSettings} from '@vt/graph-model/settings'

type SettingsWithPtyBackend = VTSettings & {
    readonly ptyBackend?: 'node-pty' | 'tmux'
}

export type LaunchTerminalSpawnParams = {
    readonly contextNodeId: NodeIdAndFilePath
    readonly resolvedTaskNodeId: NodeIdAndFilePath
    readonly resolvedTerminalCount: number
    readonly command: string
    readonly settings: VTSettings
    readonly startUnpinned?: boolean
    readonly spawnDirectory?: string
    readonly parentTerminalId?: string
    readonly promptTemplate?: string
    readonly headless?: boolean
    readonly inheritTerminalId?: string
    readonly envOverrides?: Record<string, string>
    readonly agentName: string
    readonly terminalId: TerminalId
    readonly skipFitAnimation?: boolean
    readonly logger: SpawnTerminalLogger
}

function maybeSetTerminalBudget(terminalId: TerminalId, terminalData: TerminalData): void {
    const rawBudget: string | undefined = terminalData.initialEnvVars?.GLOBAL_SPAWN_BUDGET
    if (!rawBudget) return
    const budget: number = parseInt(rawBudget, 10)
    if (!isNaN(budget) && budget >= 0) {
        setTerminalBudget(terminalId, budget)
    }
}

function launchPreparedTerminal(
    params: LaunchTerminalSpawnParams,
    terminalData: TerminalData,
): void {
    if (params.headless) {
        const headlessCommand: string = buildHeadlessCommand(params.command)
        const headlessEnv: Record<string, string> = terminalData.initialEnvVars ?? {}
        if (params.inheritTerminalId) {
            killHeadlessAgent(params.inheritTerminalId as TerminalId)
        }
        spawnHeadlessAgent(
            getTerminalId(terminalData),
            terminalData,
            headlessCommand,
            terminalData.initialSpawnDirectory,
            headlessEnv,
            undefined,
            (params.settings as SettingsWithPtyBackend).ptyBackend ?? 'node-pty',
        )
        return
    }

    if (params.inheritTerminalId) {
        getRuntimeUI().closeTerminalById?.(params.inheritTerminalId)
    }
    getRuntimeUI().launchTerminalOntoUI?.(params.contextNodeId, terminalData, params.skipFitAnimation)
}

export async function launchTerminalSpawn(params: LaunchTerminalSpawnParams): Promise<void> {
    try {
        const terminalData: TerminalData = await prepareTerminalDataInMain(
            params.contextNodeId,
            params.resolvedTaskNodeId,
            params.resolvedTerminalCount,
            params.command,
            params.settings,
            params.startUnpinned,
            params.spawnDirectory,
            params.parentTerminalId,
            params.promptTemplate,
            params.headless,
            params.inheritTerminalId,
            params.envOverrides,
            params.agentName
        )

        launchPreparedTerminal(params, terminalData)

        if (params.parentTerminalId) {
            getRuntimeUI().registerChildIfMonitored?.(params.parentTerminalId, getTerminalId(terminalData))
        }
        maybeSetTerminalBudget(params.terminalId, terminalData)
    } catch (err) {
        clearPendingTerminal(params.terminalId)
        params.logger.error(`[spawnTerminalWithContextNode] async spawn failed for ${params.terminalId}:`, err)
    }
}
