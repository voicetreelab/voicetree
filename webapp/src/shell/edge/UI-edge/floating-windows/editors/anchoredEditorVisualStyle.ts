import type { CollectionReturnValue, NodeSingular } from 'cytoscape';

import { CIRCLE_SIZE } from '@vt/graph-model/graph';

type AnyNode = NodeSingular | CollectionReturnValue;

/**
 * Apply the visual style for "anchored editor open" state to a cy node:
 * hides the node so the DOM editor floats over it, and disables Cy events
 * so clicks reach the editor instead of the node.
 *
 * Folders are skipped because they are compound nodes whose bbox encloses
 * all children. Mutating their inline style turns the entire compound area
 * into a giant invisible-but-interactive (or, post-cleanup, giant visible)
 * ellipse — the "big circle folder node" bug.
 */
export function applyAnchoredEditorOpenStyle(node: AnyNode): void {
    if (node.length === 0) return;
    if (node.data('isFolderNode') === true) return;
    node.style({
        'background-opacity': 0,
        'border-opacity': 0,
        'outline-opacity': 0,
        'shape': 'ellipse',
        'events': 'no',
    });
}

/**
 * Restore the cy node's visual style when an anchored editor closes.
 * Folders are skipped — they should remain the dashed roundrectangle
 * defined by the folder rule, not become a CIRCLE_SIZE ellipse.
 */
export function applyAnchoredEditorCloseStyle(node: AnyNode): void {
    if (node.length === 0) return;
    if (node.data('isFolderNode') === true) return;
    node.style({
        'background-opacity': 1,
        'border-opacity': 1,
        'outline-opacity': 1,
        'events': 'yes',
        'width': CIRCLE_SIZE,
        'height': CIRCLE_SIZE,
        'shape': 'ellipse',
    });
}
