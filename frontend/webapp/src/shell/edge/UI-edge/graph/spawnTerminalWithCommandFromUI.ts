import type {NodeId, Position} from "@/pure/graph";
import type {Core} from "cytoscape";
import {nodeIdToFilePathWithExtension} from "@/pure/graph/markdown-parsing";

/**
 * Terminal metadata required for spawning a terminal
 */
export interface TerminalMetadata {
    id: string;
    name: string;
    filePath?: string;
    initialCommand?: string;
    executeCommand?: boolean;
}

/**
 * Spawn a terminal for a node
 * Common function used by context menu, hotkey, and editor
 *
 * @param nodeId - The node ID to spawn terminal for
 * @param cy - Cytoscape instance
 * @param createFloatingTerminal - Function to create the floating terminal window
 */
export async function spawnTerminalForNode(
    nodeId: NodeId,
    cy: Core,
    createFloatingTerminal: (nodeId: string, metadata: TerminalMetadata, pos: Position) => Promise<void>
): Promise<void> {
    // Load settings to get the agentCommand
    const settings = await window.electronAPI?.main.loadSettings();
    const agentCommand = settings?.agentCommand ?? './claude.sh';

    // Get file path for the node
    const filePath = nodeIdToFilePathWithExtension(nodeId);

    const nodeMetadata: TerminalMetadata = {
        id: nodeId,
        name: nodeId.replace(/_/g, ' '),
        filePath: filePath,
        initialCommand: agentCommand,
        executeCommand: true
    };

    const targetNode = cy.getElementById(nodeId);
    if (targetNode.length > 0) {
        const nodePos = targetNode.position();
        await createFloatingTerminal(nodeId, nodeMetadata, nodePos);
    }
}