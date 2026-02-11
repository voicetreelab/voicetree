/**
 * Close the editor or terminal associated with the currently selected node.
 * Standalone function extracted from VoiceTreeGraphView for modularity.
 */
import type {Core} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import {closeEditor} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {closeSettingsEditor, isSettingsEditorOpen} from '@/shell/edge/UI-edge/settings/createSettingsEditor';
import {getEditorByNodeId} from '@/shell/edge/UI-edge/state/EditorStore';
import {getTerminalByNodeId} from '@/shell/edge/UI-edge/state/TerminalStore';
import {closeTerminal} from '@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal';
import type {EditorData} from '@/shell/edge/UI-edge/floating-windows/editors/editorDataType';
import type {TerminalData} from '@/shell/electron';

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

    // Try closing editor first
    const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
    if (O.isSome(editor)) {
        closeEditor(cy, editor.value);
        return;
    }

    // Try closing terminal
    const terminal: O.Option<TerminalData> = getTerminalByNodeId(nodeId);
    if (O.isSome(terminal)) {
        void closeTerminal(terminal.value, cy);
    }
}
