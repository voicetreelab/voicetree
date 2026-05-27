import type {TerminalData, TerminalId} from '../terminals/terminal-registry/types'
import {getTerminalId} from '../terminals/terminal-registry/types'
import {clearPendingTerminal, recordTerminalPending, removeTerminalFromRegistry} from '../terminals/terminal-registry'
import {setTerminalBudget} from '../terminals/global-budget-registry'
import {spawnHeadlessAgent, killHeadlessAgent} from '@vt/vt-daemon/agents/headless/headlessAgentManager.ts'
import {publishTerminalRegistryEvent} from '../terminals/terminal-registry/terminal-registry-publisher'
import {buildHeadlessCommand} from './cli/headlessCli'
import {prepareTerminalDataInMain} from './terminalData'
import type {SpawnTerminalLogger} from './reloadNodeFromDisk'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {VTSettings} from '@vt/graph-model/settings'

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

async function launchPreparedTerminal(
    params: LaunchTerminalSpawnParams,
    terminalData: TerminalData,
): Promise<void> {
    if (params.headless) {
        // Use the prepared initialCommand (which has VoiceTree's hook flags
        // already injected by prepareTerminalDataInMain) rather than
        // params.command which is the raw settings value.
        const headlessCommand: string = buildHeadlessCommand(terminalData.initialCommand ?? params.command)
        const headlessEnv: Record<string, string> = terminalData.initialEnvVars ?? {}
        if (params.inheritTerminalId) {
            // Await the kill so the replacement spawn below doesn't race the
            // tmux session teardown — otherwise two sessions briefly share an
            // alias and we re-bind to the dying one.
            await killHeadlessAgent(params.inheritTerminalId as TerminalId)
        }
        spawnHeadlessAgent(
            getTerminalId(terminalData),
            terminalData,
            headlessCommand,
            terminalData.initialSpawnDirectory,
            headlessEnv,
        )
        return
    }

    if (params.inheritTerminalId) {
        // Inherit replaces the row at the same terminalId. Fire `terminal-removed`
        // (via removeTerminalFromRegistry) so receivers drop the old floating
        // window before the `terminal-ui-launch` below creates the new one;
        // re-pend the same id so MCP probes mid-spawn still resolve.
        removeTerminalFromRegistry(params.inheritTerminalId)
        recordTerminalPending(params.inheritTerminalId, !!params.headless)
    }
    publishTerminalRegistryEvent({
        type: 'terminal-ui-launch',
        nodeId: params.contextNodeId,
        terminalData,
        skipFitAnimation: !!params.skipFitAnimation,
    })
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

        await launchPreparedTerminal(params, terminalData)

        if (params.parentTerminalId) {
            publishTerminalRegistryEvent({
                type: 'terminal-ui-child-registered',
                parentTerminalId: params.parentTerminalId as TerminalId,
                childTerminalId: getTerminalId(terminalData),
            })
        }
        maybeSetTerminalBudget(params.terminalId, terminalData)
    } catch (err) {
        clearPendingTerminal(params.terminalId)
        params.logger.error(`[spawnTerminalWithContextNode] async spawn failed for ${params.terminalId}:`, err)
    }
}
