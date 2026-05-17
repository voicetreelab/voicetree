/**
 * FolderHandleService — native-canvas affordances for folder compound nodes.
 *
 * The expanded folder's TL chevron is now rendered as a cytoscape
 * background-image (see `defaultNodeStyles.ts`), so this module only owns the
 * input wiring:
 *
 *   1. A single `tap` hit-test on the TL 22×22 px region of expanded folders
 *      → toggles collapse. Matches the prior DOM chip's clickable area
 *      (offset −1px, −1px from the rendered bbox TL).
 *
 *   2. The pre-existing folder-body mousedown → manual pan loop (from
 *      e7324661) — preserved verbatim since the folder body is ungrabified
 *      and cytoscape otherwise wouldn't translate body-drag into pan.
 *
 * Pulled out:
 *   - DOM overlay container + chip elements
 *   - `pan zoom`, `position`, `add`, `remove`, `data` listeners (these were
 *     calling `renderedBoundingBox()` per folder per frame, which froze
 *     trackpad pan on graphs with many folders).
 */
import type {Core, EventObject, NodeSingular} from 'cytoscape';
import {toggleFolderCollapse} from '@/shell/edge/UI-edge/graph/view/folderCollapse';
import {FOLDER_CHEVRON_HIT_SIZE_PX} from '@/shell/UI/cytoscape-graph-ui/services/styles/defaultNodeStyles';
import {signalViewportManipulationCached} from '@/shell/UI/cytoscape-graph-ui/services/animation/largegraphPerformance';
import {dispatchSetPan, getLayout} from '@vt/graph-state/state/layoutStore';

export function setupFolderHandles(cy: Core): void {
    let folderBodyPan: {lastX: number; lastY: number} | null = null;

    cy.on('tap', 'node[?isFolderNode][!collapsed]', (evt: EventObject): void => {
        const node: NodeSingular = evt.target;
        // Convert rendered click position into model coords. The chevron is
        // painted at cytoscape's compound TL = (position.x − totalWidth/2,
        // position.y − totalHeight/2). Match that exactly so the hit-test
        // tracks the rendered chevron regardless of label extents,
        // bounds-expansion, or other bbox-padding factors.
        const zoom: number = cy.zoom();
        const pan: {x: number; y: number} = cy.pan();
        const modelX: number = (evt.renderedPosition.x - pan.x) / zoom;
        const modelY: number = (evt.renderedPosition.y - pan.y) / zoom;
        const pos = node.position();
        const padding: number = node.padding();
        const halfTotalW: number = node.width() / 2 + padding;
        const halfTotalH: number = node.height() / 2 + padding;
        const dx: number = modelX - (pos.x - halfTotalW);
        const dy: number = modelY - (pos.y - halfTotalH);
        if (dx < 0 || dx > FOLDER_CHEVRON_HIT_SIZE_PX || dy < 0 || dy > FOLDER_CHEVRON_HIT_SIZE_PX) return;

        evt.originalEvent?.stopPropagation();
        evt.originalEvent?.preventDefault();
        void toggleFolderCollapse(cy, node.id());
    });

    cy.on('mousedown', 'node[?isFolderNode]', (evt: EventObject): void => {
        const node: NodeSingular = evt.target;
        if (node.data('collapsed') === true) return;

        const start: MousePosition | null = mousePositionFromEvent(evt.originalEvent);
        if (!start || start.button !== 0) return;

        folderBodyPan = {lastX: start.clientX, lastY: start.clientY};
        window.addEventListener('mousemove', handleFolderBodyPanMove, {capture: true});
        window.addEventListener('mouseup', handleFolderBodyPanEnd, {capture: true, once: true});
        evt.originalEvent?.preventDefault();
    });

    function handleFolderBodyPanMove(evt: MouseEvent): void {
        if (!folderBodyPan) return;

        const dx: number = evt.clientX - folderBodyPan.lastX;
        const dy: number = evt.clientY - folderBodyPan.lastY;
        if (dx === 0 && dy === 0) return;

        signalViewportManipulationCached();
        const pan: {x: number; y: number} = getLayout().pan ?? {x: 0, y: 0};
        dispatchSetPan({x: pan.x + dx, y: pan.y + dy});
        folderBodyPan = {lastX: evt.clientX, lastY: evt.clientY};
        evt.preventDefault();
        evt.stopPropagation();
    }

    function handleFolderBodyPanEnd(): void {
        folderBodyPan = null;
        window.removeEventListener('mousemove', handleFolderBodyPanMove, {capture: true});
    }
}

interface MousePosition {
    readonly clientX: number;
    readonly clientY: number;
    readonly button: number;
}

function mousePositionFromEvent(evt: Event | undefined): MousePosition | null {
    if (!(evt instanceof MouseEvent)) return null;
    return {
        clientX: evt.clientX,
        clientY: evt.clientY,
        button: evt.button,
    };
}
