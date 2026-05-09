/**
 * Lazy-spawns a dedicated "hook" terminal for dispatching onNewNode hooks.
 * Fixed terminal ID 'hook'. Re-spawns if terminal exited or was removed.
 * Commands are written directly via terminalManager.write() for speed.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, Position} from '@vt/graph-model/graph'
import {createNewNodeNoParent} from '@vt/graph-model/graph'
import {calculateNodePosition} from '@vt/graph-model/spatial'
import {buildSpatialIndexFromGraph} from '@vt/graph-model/spatial'
import type {SpatialIndex} from '@vt/graph-model/spatial'
import type {VTSettings} from '@vt/graph-model/settings'
import {createTerminalData, type TerminalId} from '../types'
import type {TerminalData} from '../types'
import {getTerminalRecords, type TerminalRecord} from '../terminals/terminal-registry'
import {getTerminalManager} from '../terminals/terminal-manager-instance'
import {loadSettings} from '@vt/app-config/settings'
import {buildTerminalEnvVars} from './buildTerminalEnvVars'
import {applyRuntimeGraphDelta, getRuntimeGraph, getRuntimeWatchStatus, getRuntimeWritePath} from '../runtime/graph-bridge'
import {getRuntimeUI} from '../runtime/runtime-config'

const HOOK_TERMINAL_ID: TerminalId = 'hook' as TerminalId
const TERMINAL_READY_POLL_MS: number = 100
const TERMINAL_READY_TIMEOUT_MS: number = 10000
const SHELL_INIT_DELAY_MS: number = 300

let hookNodeId: string | null = null
let spawnInProgress: Promise<void> | null = null

type HookTerminalWaitDeps = {
    now(): number
    sleep(ms: number): Promise<void>
    isAlive(): boolean
}

type HookTerminalLogger = {
    error(message?: unknown, ...optionalParams: unknown[]): void
}

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
async function waitForTerminalReady(
    deps: HookTerminalWaitDeps = {
        now: Date.now,
        sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
        isAlive: isHookTerminalAlive,
    },
): Promise<boolean> {
    const startTime: number = deps.now()
    while (deps.now() - startTime < TERMINAL_READY_TIMEOUT_MS) {
        if (deps.isAlive()) {
            // Brief delay for shell prompt initialization
            await deps.sleep(SHELL_INIT_DELAY_MS)
            return true
        }
        await deps.sleep(TERMINAL_READY_POLL_MS)
    }
    return false
}

async function createHookNode(): Promise<string> {
    const writePathOption: O.Option<string> = await getRuntimeWritePath()
    const writePath: string = O.getOrElse(() => '')(writePathOption)
    if (!writePath) {
        throw new Error('No write path available for hook terminal node')
    }

    const graph: Graph = getRuntimeGraph()
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

    await applyRuntimeGraphDelta(hookDelta)
    return hookNode.absoluteFilePathIsID
}

async function spawnHookTerminal(
    logger: HookTerminalLogger = { error: console.error },
): Promise<void> {
    const settings: VTSettings = await loadSettings()

    if (!hookNodeId || !getRuntimeGraph().nodes[hookNodeId]) {
        hookNodeId = await createHookNode()
    }

    // Spawn in project root (watched directory), not the terminal-relative path —
    // hook scripts use absolute node paths and expect project root as CWD
    const watchStatus: {readonly isWatching: boolean; readonly directory: string | undefined} = getRuntimeWatchStatus()
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
    getRuntimeUI().launchTerminalOntoUI?.(hookNodeId, terminalData, true)

    const ready: boolean = await waitForTerminalReady()
    if (!ready) {
        logger.error('[spawnHookTerminal] Timed out waiting for hook terminal PTY')
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
