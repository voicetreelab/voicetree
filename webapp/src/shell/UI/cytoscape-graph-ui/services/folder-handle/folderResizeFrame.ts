/**
 * FolderResizeController — DOM resize-grip overlay for EXPANDED folder
 * compounds, a sibling concern to the chip strip in FolderHandleService.
 *
 * One frame per expanded folder; eight invisible hit zones (four edges + four
 * corners) anchored to the folder BODY box, each with its directional cursor.
 * Grip thickness is constant screen px so the target stays easy to hit at any
 * zoom. Dragging a grip:
 *   - live: stamps folderWidth/folderHeight data (the stylesheet maps it to the
 *     compound's min-width/min-height) for immediate feel — the SAME data the
 *     persisted-size apply path uses.
 *   - on mouseup: persists the size keyed by the folder's DIRECTORY id via the
 *     unified write-node-layout channel (same channel node-drag uses, no new
 *     RPC). The folder need not have a note — size is owned by the directory.
 *
 * Collapsed pills are fixed-size and never get a frame.
 */
import type {Core, NodeSingular} from 'cytoscape';
import type cytoscape from 'cytoscape';

import type {Size} from '@vt/graph-model/graph';
import {
    ALL_RESIZE_HANDLES,
    computeResizedFolderSize,
    type ResizeHandle,
} from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/folderResize';

const RESIZE_STYLE_TAG_ID = 'vt-folder-resize-style';
const FRAME_CLASS = 'vt-folder-resize-frame';
const GRIP_CLASS = 'vt-folder-resize-grip';
const GRIP_PX = 12;

// Folder BODY box (no label, no overlays) — same convention as the chip strip
// and the folder-handle e2e specs, so the frame hugs the drawn folder body.
const BODY_BBOX_OPTIONS: cytoscape.BoundingBoxOptions = {
    includeLabels: false,
    includeOverlays: false,
};

const GRIP_CURSOR: Record<ResizeHandle, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

export interface FolderResizeController {
    /** Create a frame for an expanded folder, or remove it if the folder is collapsed/gone. */
    ensure(folderId: string): void;
    position(folderId: string): void;
    positionAll(): void;
    destroy(folderId: string): void;
}

interface FrameEntry {
    readonly el: HTMLDivElement;
    readonly grips: ReadonlyMap<ResizeHandle, HTMLDivElement>;
}

function injectResizeStylesheet(): void {
    if (document.getElementById(RESIZE_STYLE_TAG_ID) !== null) return;
    const style: HTMLStyleElement = document.createElement('style');
    style.id = RESIZE_STYLE_TAG_ID;
    style.textContent = `
.${FRAME_CLASS} { position: absolute; pointer-events: none; z-index: 5; }
.${GRIP_CLASS} { position: absolute; pointer-events: auto; background: transparent; -webkit-app-region: no-drag; }
`;
    document.head.appendChild(style);
}

// Lay a grip out within the frame (frame is sized to the folder body box, so
// offsets are relative to its top-left). Edges span their side minus the corner
// gutters; corners sit on top at the four extremities.
function layoutGrip(grip: HTMLDivElement, handle: ResizeHandle): void {
    const s: string = `${GRIP_PX}px`;
    const half: string = `-${GRIP_PX / 2}px`;
    grip.style.cursor = GRIP_CURSOR[handle];
    for (const prop of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) grip.style[prop] = '';
    if (handle.length === 2) {
        grip.style.width = s;
        grip.style.height = s;
        grip.style.zIndex = '1';
        grip.style[handle.includes('n') ? 'top' : 'bottom'] = half;
        grip.style[handle.includes('w') ? 'left' : 'right'] = half;
        return;
    }
    if (handle === 'n' || handle === 's') {
        grip.style.left = s;
        grip.style.right = s;
        grip.style.height = s;
        grip.style[handle === 'n' ? 'top' : 'bottom'] = half;
    } else {
        grip.style.top = s;
        grip.style.bottom = s;
        grip.style.width = s;
        grip.style[handle === 'w' ? 'left' : 'right'] = half;
    }
}

function isExpandedFolder(node: cytoscape.CollectionReturnValue): boolean {
    return node.length > 0 && node.data('isFolderNode') === true && node.data('collapsed') !== true;
}

export function setupFolderResize(
    cy: Core,
    overlay: HTMLElement,
): FolderResizeController {
    injectResizeStylesheet();
    const frames: Map<string, FrameEntry> = new Map();

    function position(folderId: string): void {
        const entry: FrameEntry | undefined = frames.get(folderId);
        if (entry === undefined) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;
        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH =
            (node as NodeSingular).renderedBoundingBox(BODY_BBOX_OPTIONS);
        entry.el.style.left = `${bbox.x1}px`;
        entry.el.style.top = `${bbox.y1}px`;
        entry.el.style.width = `${bbox.w}px`;
        entry.el.style.height = `${bbox.h}px`;
    }

    function beginDrag(folderId: string, handle: ResizeHandle, startEvent: MouseEvent): void {
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (!isExpandedFolder(node)) return;
        const bbox: cytoscape.BoundingBoxWH = (node as NodeSingular).boundingBox(BODY_BBOX_OPTIONS);
        const startSize: Size = {width: bbox.w, height: bbox.h};
        const startX: number = startEvent.clientX;
        const startY: number = startEvent.clientY;
        let latest: Size = startSize;

        // Coalesce mousemoves to one rAF tick. Raw mousemove can fire faster than
        // the display refresh (high-Hz mice, trackpads), and each folderWidth /
        // folderHeight write runs cytoscape's updateStyle across the folder + its
        // descendants + its parents. Writing per-event flooded that pipeline with
        // hundreds of style cycles a second and the renderer fell seconds behind
        // — the symptom the grip drag was hitting and the smooth node-drag was
        // not (cytoscape's own drag loop is already rAF-throttled).
        //
        // Not wrapped in cy.batch(): batching defers style application until
        // endBatch, but the synchronous 'data' event fires INSIDE the batch and
        // the chip strip's listener reads renderedBoundingBox with the stale
        // min-* values — chips would then lag the folder body by a frame instead
        // of leading it. Unbatched writes keep chip + body in lockstep.
        let pending: Size | null = null;
        let rafId: number | null = null;

        const flush = (): void => {
            rafId = null;
            if (pending === null) return;
            const next: Size = pending;
            pending = null;
            node.data('folderWidth', next.width);
            node.data('folderHeight', next.height);
            position(folderId);
            latest = next;
        };

        const onMove = (evt: MouseEvent): void => {
            pending = computeResizedFolderSize(
                startSize,
                {dx: evt.clientX - startX, dy: evt.clientY - startY},
                handle,
                cy.zoom(),
            );
            if (rafId === null) rafId = window.requestAnimationFrame(flush);
        };

        const onUp = (): void => {
            window.removeEventListener('mousemove', onMove, {capture: true});
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
                flush();
            }
            void persist(folderId, latest);
        };

        window.addEventListener('mousemove', onMove, {capture: true});
        window.addEventListener('mouseup', onUp, {capture: true, once: true});
        startEvent.preventDefault();
        startEvent.stopPropagation();
    }

    async function persist(folderId: string, size: Size): Promise<void> {
        // Folder size is owned by the directory id (the compound is not a graph
        // node, and a folder need not have a note). Persist keyed by folderId
        // through the unified spatial-layout channel.
        await window.electronAPI?.main.saveNodeSize(folderId, size);
    }

    function createFrame(folderId: string): void {
        if (frames.has(folderId)) return;
        const el: HTMLDivElement = document.createElement('div');
        el.className = FRAME_CLASS;
        el.dataset.folderId = folderId;
        const grips: Map<ResizeHandle, HTMLDivElement> = new Map();
        for (const handle of ALL_RESIZE_HANDLES) {
            const grip: HTMLDivElement = document.createElement('div');
            grip.className = GRIP_CLASS;
            layoutGrip(grip, handle);
            grip.addEventListener('mousedown', (evt: MouseEvent): void => {
                if (evt.button !== 0) return;
                beginDrag(folderId, handle, evt);
            });
            el.appendChild(grip);
            grips.set(handle, grip);
        }
        overlay.appendChild(el);
        frames.set(folderId, {el, grips});
        position(folderId);
    }

    function destroy(folderId: string): void {
        const entry: FrameEntry | undefined = frames.get(folderId);
        if (entry === undefined) return;
        entry.el.remove();
        frames.delete(folderId);
    }

    function ensure(folderId: string): void {
        if (isExpandedFolder(cy.getElementById(folderId))) createFrame(folderId);
        else destroy(folderId);
    }

    function positionAll(): void {
        for (const folderId of frames.keys()) position(folderId);
    }

    return {ensure, position, positionAll, destroy};
}
