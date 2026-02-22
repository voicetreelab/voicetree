import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { NodePresentation, NodeState } from '@/pure/graph/node-presentation/types';
import { getStateDimensions } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import { modifyNodeContentFromUI } from '@/shell/edge/UI-edge/floating-windows/editors/modifyNodeContentFromFloatingEditor';
import { markNodeDirty } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';
import type { VTSettings } from '@/pure/settings/types';
import { mountFolderContent } from './mountFolderContent';

// Track mounting state to prevent double-mounts during async gap
const mountingEditors: Set<string> = new Set();

// Store editor instances per nodeId (since NodePresentation type doesn't have editor field)
const editors: Map<string, CodeMirrorEditorView> = new Map();

export function getEditor(nodeId: string): CodeMirrorEditorView | undefined {
    return editors.get(nodeId);
}

/**
 * Transition a node presentation to a new state. Handles:
 * - Mounting CodeMirror on first HOVER/ANCHORED (async, with concurrency guard)
 * - Applying CSS state classes
 * - Updating Cy node dimensions for Cola layout
 * - Updating preview text when collapsing from editor states
 */
export async function transitionTo(
    cy: Core,
    nodeId: string,
    targetState: NodeState
): Promise<void> {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;
    if (presentation.state === targetState) return;

    const previousState: NodeState = presentation.state;

    // Mount content on first expansion to HOVER or ANCHORED
    if (targetState === 'HOVER' || targetState === 'ANCHORED') {
        if (presentation.kind === 'folder') {
            // Folder: mount child list instead of CodeMirror
            if (!presentation.element.querySelector('.folder-children-preview')?.hasChildNodes()) {
                await mountFolderContent(cy, nodeId, presentation);
                const recheck: NodePresentation | undefined = getPresentation(nodeId);
                if (!recheck) return;
            }
        } else if (!editors.has(nodeId)) {
            // Regular: mount CodeMirror editor
            await mountEditor(cy, nodeId, presentation);
            const recheck: NodePresentation | undefined = getPresentation(nodeId);
            if (!recheck) return;
        }
    }

    // Remove all state classes, then apply target
    presentation.element.classList.remove('state-plain', 'state-card', 'state-hover', 'state-anchored');
    presentation.element.classList.add(`state-${targetState.toLowerCase()}`);

    // Update mutable state
    presentation.state = targetState;

    // Update Cy node dimensions so Cola layout knows the new size
    const dims: { readonly width: number; readonly height: number } = getStateDimensions(targetState, presentation.kind);
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({
            'width': dims.width,
            'height': dims.height,
        });
        markNodeDirty(cy, nodeId);
    }

    // Show/hide content area based on state and kind
    const editor: CodeMirrorEditorView | undefined = editors.get(nodeId);
    if (targetState === 'HOVER' || targetState === 'ANCHORED') {
        if (presentation.kind === 'folder') {
            // Show folder children preview
            const folderContent: HTMLElement | null = presentation.element.querySelector('.folder-children-preview');
            if (folderContent) {
                folderContent.style.display = '';
            }
            // ANCHORED: expand compound — show children in graph
            if (targetState === 'ANCHORED') {
                const compoundNode: CollectionReturnValue = cy.getElementById(nodeId);
                compoundNode.children().style({ 'visibility': 'visible' } as Record<string, unknown>);
            }
        } else {
            // Show editor area for regular nodes
            const editorArea: HTMLElement | null = presentation.element.querySelector('.node-presentation-editor');
            if (editorArea) {
                editorArea.style.display = '';
            }
            if (targetState === 'ANCHORED' && editor) {
                editor.focus();
            }
        }
    }

    // When collapsing back to CARD or PLAIN: hide content, update preview
    if ((targetState === 'CARD' || targetState === 'PLAIN') &&
        (previousState === 'HOVER' || previousState === 'ANCHORED')) {
        if (presentation.kind === 'folder') {
            // Hide folder content area
            const folderContent: HTMLElement | null = presentation.element.querySelector('.folder-children-preview');
            if (folderContent) {
                folderContent.style.display = 'none';
            }
        } else {
            // Hide editor area
            const editorArea: HTMLElement | null = presentation.element.querySelector('.node-presentation-editor');
            if (editorArea) {
                editorArea.style.display = 'none';
            }
            // Update preview from editor content
            if (editor) {
                const currentContent: string = editor.getValue();
                const previewEl: HTMLElement | null = presentation.element.querySelector('.node-presentation-preview');
                if (previewEl) {
                    previewEl.textContent = currentContent
                        .split('\n')
                        .filter((line: string) => line.trim().length > 0)
                        .slice(0, 3)
                        .join('\n');
                }
            }
        }
    }
}

/**
 * Mount a CodeMirror editor into a presentation's editor area.
 * Creates the editor area div if it doesn't exist, fetches node content,
 * and creates the CodeMirror instance. Guards against concurrent mounts.
 */
async function mountEditor(
    cy: Core,
    nodeId: string,
    presentation: NodePresentation
): Promise<void> {
    if (mountingEditors.has(nodeId)) return;
    mountingEditors.add(nodeId);

    try {
        // Create editor area div if not present
        let editorArea: HTMLElement | null = presentation.element.querySelector('.node-presentation-editor');
        if (!editorArea) {
            editorArea = document.createElement('div');
            editorArea.className = 'node-presentation-editor';
            presentation.element.appendChild(editorArea);
        }

        const [node, settings] = await Promise.all([
            getNodeFromMainToUI(nodeId),
            window.electronAPI!.main.loadSettings() as Promise<VTSettings>
        ]);

        // Re-check after async: presentation might have been destroyed
        const recheck: NodePresentation | undefined = getPresentation(nodeId);
        if (!recheck || editors.has(nodeId)) return;

        const content: string = fromNodeToContentWithWikilinks(node);

        const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
            editorArea,
            content,
            {
                autosaveDelay: 300,
                darkMode: document.documentElement.classList.contains('dark'),
                vimMode: settings.vimMode ?? false,
                nodeId: nodeId,
            }
        );

        editors.set(nodeId, editor);

        // Auto-save: debounced content changes written back to graph
        editor.onChange((newContent: string): void => {
            void modifyNodeContentFromUI(nodeId as NodeIdAndFilePath, newContent, cy);
        });
    } finally {
        mountingEditors.delete(nodeId);
    }
}

/**
 * Cleanup editor for a node. Called when destroyNodePresentation is called.
 */
export function disposeEditor(nodeId: string): void {
    const editor: CodeMirrorEditorView | undefined = editors.get(nodeId);
    if (editor) {
        editor.dispose();
        editors.delete(nodeId);
    }
}
