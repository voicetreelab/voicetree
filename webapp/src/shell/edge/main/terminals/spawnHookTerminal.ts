/**
 * Lazy-spawns a dedicated "hook" terminal for dispatching onNewNode hooks.
 * Fixed terminal ID 'hook'. Re-spawns if terminal exited or was removed.
 * Commands are written directly via terminalManager.write() for speed.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, Position} from '@/pure/graph'
import {createNewNodeNoParent} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas'
import {calculateNodePosition} from '@/pure/graph/positioning/calculateInitialPosition'
import {buildSpatialIndexFromGraph} from '@/pure/graph/positioning/spatialAdapters'
import type {SpatialIndex} from '@/pure/graph/spatial'
import type {VTSettings} from '@/pure/settings/types'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWatchStatus} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/vault-allowlist'
import {buildTerminalEnvVars} from '@/shell/edge/main/terminals/buildTerminalEnvVars'

const HOOK_TERMINAL_ID: TerminalId = 'hook' as TerminalId
const TERMINAL_READY_POLL_MS: number = 100
const TERMINAL_READY_TIMEOUT_MS: number = 10000
const SHELL_INIT_DELAY_MS: number = 300

let hookNodeId: string | null = null
let spawnInProgress: Promise<void> | null = null

function isHookTerminalAlive(): boolean {
    const records: TerminalRecord[] = getTerminalRecords()
    const existing: TerminalRecord | undefined = records.find(
        (r: TerminalRecord) => r.terminalId === HOOK_TERMINAL_ID
    )
    return existing !== undefined && existing.status === 'running'
}

/**
 * Poll terminal registry until hook terminal appears with status 'running'.
 * The PTY is spawned asynchronously via IPC roundtrip to the renderer,
 * so we poll until it registers in the main-process terminal registry.
 */
async function waitForTerminalReady(): Promise<boolean> {
    const startTime: number = Date.now()
    while (Date.now() - startTime < TERMINAL_READY_TIMEOUT_MS) {
        if (isHookTerminalAlive()) {
            // Brief delay for shell prompt initialization
            await new Promise(resolve => setTimeout(resolve, SHELL_INIT_DELAY_MS))
            return true
        }
        await new Promise(resolve => setTimeout(resolve, TERMINAL_READY_POLL_MS))
    }
    return false
}

async function createHookNode(): Promise<string> {
    const writePathOption: O.Option<string> = await getWritePath()
    const writePath: string = O.getOrElse(() => '')(writePathOption)
    if (!writePath) {
        throw new Error('No write path available for hook terminal node')
    }

    const graph: Graph = getGraph()
    const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(graph)
    const hookPosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(calculateNodePosition(graph, spatialIndex))
    const {newNode}: {readonly newNode: GraphNode; readonly graphDelta: GraphDelta} =
        createNewNodeNoParent(hookPosition, writePath, graph)

    const hookNode: GraphNode = {...newNode, contentWithoutYamlOrLinks: '# Hook Terminal'}
    const hookDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: hookNode,
        previousNode: O.none
    }]

    await applyGraphDeltaToDBThroughMemAndUIAndEditors(hookDelta)
    return hookNode.absoluteFilePathIsID
}

async function spawnHookTerminal(): Promise<void> {
    const settings: VTSettings = await loadSettings()

    if (!hookNodeId || !getGraph().nodes[hookNodeId]) {
        hookNodeId = await createHookNode()
    }

    // Spawn in project root (watched directory), not the terminal-relative path —
    // hook scripts use absolute node paths and expect project root as CWD
    const watchStatus: {readonly isWatching: boolean; readonly directory: string | undefined} = getWatchStatus()
    const initialSpawnDirectory: string | undefined = watchStatus.directory

    const expandedEnvVars: Record<string, string> = await buildTerminalEnvVars({
        contextNodePath: hookNodeId,
        taskNodePath: hookNodeId,
        terminalId: HOOK_TERMINAL_ID,
        agentName: HOOK_TERMINAL_ID,
        settings,
    })

    const terminalData: TerminalData = createTerminalData({
        terminalId: HOOK_TERMINAL_ID,
        attachedToNodeId: hookNodeId,
        terminalCount: 0,
        title: 'Hook Terminal',
        anchoredToNodeId: hookNodeId,
        executeCommand: false,
        initialSpawnDirectory,
        initialEnvVars: expandedEnvVars,
        agentName: HOOK_TERMINAL_ID,
        isPinned: false,
    })

    // Launch terminal UI — async IPC roundtrip: main → renderer → main (PTY spawn)
    void uiAPI.launchTerminalOntoUI(hookNodeId, terminalData, true)

    const ready: boolean = await waitForTerminalReady()
    if (!ready) {
        console.error('[spawnHookTerminal] Timed out waiting for hook terminal PTY')
    }
}

/**
 * Ensure the hook terminal is running. Lazy-spawns on first call.
 * Re-spawns if the terminal exited or was removed.
 * Serializes concurrent spawn attempts to avoid duplicates.
 */
export async function ensureHookTerminal(): Promise<void> {
    if (isHookTerminalAlive()) return

    if (spawnInProgress) {
        await spawnInProgress
        return
    }

    spawnInProgress = spawnHookTerminal()
    try {
        await spawnInProgress
    } finally {
        spawnInProgress = null
    }
}

/**
 * Write a command directly to the hook terminal PTY.
 * Uses terminalManager.write() — no char-by-char delay since
 * we know the terminal is at a shell prompt.
 */
export function writeToHookTerminal(command: string): void {
    getTerminalManager().write(HOOK_TERMINAL_ID, command + '\r')
}
