import type {} from '@/shell/electron';
import type {Core} from "cytoscape";
import type { Position as CyPosition, CollectionReturnValue } from "cytoscape";
import type {Position} from "@/pure/graph";
import {
    createTerminalData,
    getTerminalId,
    type TerminalData,
    type TerminalId,
} from "@/shell/edge/UI-edge/floating-windows/types";
import {
    createFloatingTerminal
} from "@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI";
import {addTerminal, getNextTerminalCount, getTerminals} from "@/shell/edge/UI-edge/state/TerminalStore";

export async function spawnBackupTerminal(cy: Core): Promise<void> {
    // Get watch directory from IPC
    const status: { readonly isWatching: boolean; readonly directory: string | undefined; } | undefined = await window.electronAPI?.main.getWatchStatus();
    const watchDir: string | undefined = status?.directory;

    if (!watchDir) {
        console.warn('[backup] No watched directory available');
        return;
    }

    // Extract vault folder name for backup naming
    const vaultName: string = watchDir.split('/').pop() ?? 'vault';

    // Generate command: move vault to timestamped backup, then recreate empty vault
    const backupCommand: string = `mkdir -p "${watchDir}/../backups" && mv "${watchDir}" "${watchDir}/../backups/${vaultName}-$(date +%Y%m%d-%H%M%S)" && mkdir -p "${watchDir}"`;

    // Get position in center of current viewport (where user is looking)
    const pan: CyPosition = cy.pan();
    const zoom: number = cy.zoom();
    const centerX: number = (cy.width() / 2 - pan.x) / zoom;
    const centerY: number = (cy.height() / 2 - pan.y) / zoom;
    const position: Position = { x: centerX, y: centerY };

    // Get next terminal count for backup terminal
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();
    const syntheticNodeId: "backup-terminal" = 'backup-terminal';
    const terminalCount: number = getNextTerminalCount(terminalsMap, syntheticNodeId);

    // Create TerminalData using v2 factory function
    const terminalData: TerminalData = createTerminalData({
        attachedToNodeId: syntheticNodeId,
        terminalCount: terminalCount,
        title: `Backup ${vaultName}`,
        anchoredToNodeId: undefined, // Not anchored to a node
        initialCommand: backupCommand,
        executeCommand: false,
        initialSpawnDirectory: undefined,
        initialEnvVars: {},
    });

    const terminalId: TerminalId = getTerminalId(terminalData);

    // Create floating terminal with synthetic parent node
    await spawnTerminalWithSyntheticParent(cy, position, terminalData);

    // Fit the graph to include the newly spawned terminal
    setTimeout(() => {
        const terminalNode: CollectionReturnValue = cy.$(`#${terminalId}`);
        if (terminalNode.length > 0) {
            cy.fit(terminalNode, 50); // 50px padding
        }
    }, 50);

    setTimeout(() => {
        const terminalNode: CollectionReturnValue = cy.$(`#${terminalId}`);
        if (terminalNode.length > 0) {
            cy.fit(terminalNode, 50); // 50px padding
        }
    }, 800); // also after auto layout
}

export async function spawnTerminalWithSyntheticParent(
    cy: Core,
    position: Position,
    terminalData: TerminalData
): Promise<void> {
    const syntheticNodeId: string = terminalData.attachedToNodeId;

    // Create synthetic parent node if it doesn't exist
    let syntheticNode: CollectionReturnValue = cy.getElementById(syntheticNodeId);
    if (syntheticNode.length === 0) {
        syntheticNode = cy.add({
            group: 'nodes',
            data: {id: syntheticNodeId},
            position: position,
            classes: 'synthetic-node'
        });

        // Hide the synthetic node
        syntheticNode.style('display', 'none');
    }

    // Create the terminal at the specified position
    const terminalWithUI: TerminalData | undefined = await createFloatingTerminal(cy, syntheticNodeId, terminalData, position);

    // Store terminal in state (with ui populated)
    if (terminalWithUI) {
        addTerminal(terminalWithUI);
    }
}