import type {NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {
  spawnPlainTerminalWorkflow,
  spawnPlainTerminalWithNodeWorkflow,
} from '../application/workflows/plainTerminal.ts'

export async function spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void> {
  await spawnPlainTerminalWorkflow(nodeId, terminalCount)
}

/**
 * Spawns a plain terminal with a newly created markdown node attached.
 * The node enables draggability and note-saving for the terminal.
 *
 * Same logic as 'Add Node Here' but also attaches a plain terminal.
 */
export async function spawnPlainTerminalWithNode(
    position: Position,
    terminalCount: number
): Promise<void> {
    await spawnPlainTerminalWithNodeWorkflow(position, terminalCount)
}
