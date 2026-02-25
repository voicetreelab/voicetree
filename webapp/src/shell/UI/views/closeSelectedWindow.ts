/**
 * Close the editor or terminal associated with the currently selected node.
 * Standalone function extracted from VoiceTreeGraphView for modularity.
 */
import type {Core} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import {closeEditor} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {activeCardShells, destroyCardShell} from '@/shell/edge/UI-edge/floating-windows/editors/CardShell';
import {closeSettingsEditor, isSettingsEditorOpen} from '@/shell/edge/UI-edge/settings/createSettingsEditor';
import {getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {getActiveTerminalId, getTerminal} from '@/shell/edge/UI-edge/state/TerminalStore';
import {closeTerminal} from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal';
import type {EditorData} from '@/shell/edge/UI-edge/floating-windows/editors/editorDataType';
import type {TerminalData} from '@/shell/electron';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';

/**
 * Close the editor or terminal for the currently selected node (Cmd+W).
 * Falls back to closing the settings editor if no node is selected.
 */
export function closeSelectedWindow(cy: Core): void {
    const selected: cytoscape.CollectionReturnValue = cy.$(':selected');

    // If no node selected, try closing the settings editor
    if (selected.length === 0) {
        if (isSettingsEditorOpen()) {
            closeSettingsEditor(cy);
        }
        return;
    }

    const nodeId: string = selected.first().id();

    // CardShell editors: use destroyCardShell (restores Cy node opacity/shape)
    if (activeCardShells.has(nodeId)) {
        destroyCardShell(nodeId);
        return;
    }

    // Legacy anchored editors: use old closeEditor path
    const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(editor)) {
        closeEditor(cy, editor.value);
        return;
    }

    // Try closing the active terminal directly (no node lookup needed)
    const activeId: TerminalId | null = getActiveTerminalId();
    if (activeId) {
        const terminal: O.Option<TerminalData> = getTerminal(activeId);
        if (O.isSome(terminal)) {
            void closeTerminal(terminal.value, cy);
        }
    }
}
