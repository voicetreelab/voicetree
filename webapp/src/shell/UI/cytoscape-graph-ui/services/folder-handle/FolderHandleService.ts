/**
 * FolderHandleService — DOM-overlay chevron + eye chip strip at the TL of
 * every folder compound (expanded or collapsed).
 *
 *     [chevron 22×22] [eye 22×22]   → strip 44×22
 *
 * The chip strip used to live as a cytoscape `background-image`, but
 * cytoscape's WebGL renderer rasterises each node body into a texture atlas
 * cell sized to the node's bounding box. A compound folder's bbox encloses
 * every child, so the 44×22 chip ended up as a few pixels in the atlas cell
 * and turned into an unreadable grey blob after upscaling (see commit
 * history). A DOM overlay sidesteps the atlas entirely and renders the chip
 * at full CSS-pixel fidelity regardless of cy renderer.
 *
 * Input wiring:
 *
 *   1. Click chevron → toggle collapse (works in either state — the chevron
 *      glyph rotates to indicate the next action).
 *
 *   2. Click eye → open hover editor with the folder note.
 *
 *   3. Mouseenter eye → open hover editor; mouseleave → close (debounced so
 *      the cursor can travel from chip to editor without flicker).
 *
 *   4. Folder-body mousedown → manual pan loop (from e7324661), preserved —
 *      folder body is ungrabified, so cytoscape otherwise wouldn't translate
 *      body-drag into pan.
 *
 * The hover editor's own mouseleave handler closes it via a custom hover-zone
 * predicate that keeps it open while the cursor is over the eye chip OR the
 * editor itself.
 *
 * Lifecycle: one overlay per cy.container, created lazily. Chips are
 * created on folder add and destroyed on folder remove. Positions sync via
 * cy `pan`/`zoom`/`position` events — never `bounds` or `render` (both
 * re-enter renderedBoundingBox and stack-overflow; see e7324661).
 */
import type {Core, EventObject, NodeSingular} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph';
import {getFolderNotePath} from '@vt/graph-model/graph';

import {toggleFolderCollapse} from '@/shell/edge/UI-edge/graph/view/folderCollapse';
import {signalViewportManipulationCached} from '@/shell/UI/cytoscape-graph-ui/services/animation/largegraphPerformance';
import {dispatchSetPan, getLayout} from '@vt/graph-state/state/layoutStore';
import {
    closeHoverEditor,
    openHoverEditor,
} from '@/shell/edge/UI-edge/floating-windows/editors/HoverEditor';
import {getHoverEditor} from '@/shell/edge/UI-edge/state/stores/EditorStore';

const CHIP_PX = 22;

// Debounce duration for closing the hover editor after the cursor leaves the
// eye chip. Long enough for the cursor to traverse from chip to editor
// (~18px), short enough that dismissal stays responsive.
const VIEW_HOVER_CLOSE_DEBOUNCE_MS = 120;

const OVERLAY_CLASS = 'vt-folder-handle-overlay';
const CHIP_CLASS = 'vt-folder-handle';
const BUTTON_CHEVRON_CLASS = 'vt-folder-handle__chevron';
const BUTTON_EYE_CLASS = 'vt-folder-handle__eye';
const STYLE_TAG_ID = 'vt-folder-handle-style';

const CHEVRON_DOWN_SVG =
    '<svg viewBox="0 0 22 22" width="14" height="14" aria-hidden="true">' +
    '<path d="M6 9 L11 14 L16 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
const CHEVRON_RIGHT_SVG =
    '<svg viewBox="0 0 22 22" width="14" height="14" aria-hidden="true">' +
    '<path d="M9 6 L14 11 L9 16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
const EYE_SVG =
    '<svg viewBox="0 0 22 22" width="14" height="14" aria-hidden="true">' +
    '<path d="M3 11 Q11 4 19 11 Q11 18 3 11 Z" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
    '<circle cx="11" cy="11" r="2.4" fill="currentColor"/>' +
    '</svg>';

function injectStylesheet(): void {
    if (document.getElementById(STYLE_TAG_ID) !== null) return;
    const style: HTMLStyleElement = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = `
.${OVERLAY_CLASS} {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1101; /* Above the macOS title-bar drag region (1099). */
}
.${CHIP_CLASS} {
    position: absolute;
    display: flex;
    gap: 0;
    pointer-events: none;
    -webkit-app-region: no-drag;
}
.${BUTTON_CHEVRON_CLASS},
.${BUTTON_EYE_CLASS} {
    width: ${CHIP_PX}px;
    height: ${CHIP_PX}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(45, 45, 48, 0.92);
    border: 1.5px solid #888;
    border-radius: 6px;
    color: #d4d4d4;
    cursor: pointer;
    padding: 0;
    box-sizing: border-box;
    pointer-events: auto;
    -webkit-app-region: no-drag;
    transition: background-color 80ms linear, border-color 80ms linear;
}
.${BUTTON_CHEVRON_CLASS}:hover,
.${BUTTON_EYE_CLASS}:hover {
    background: rgba(60, 60, 65, 0.95);
    border-color: #aaa;
    color: #fff;
}
.${BUTTON_CHEVRON_CLASS}:focus,
.${BUTTON_EYE_CLASS}:focus {
    outline: none;
    border-color: #00cc66;
}
.${BUTTON_CHEVRON_CLASS} + .${BUTTON_EYE_CLASS} {
    margin-left: -1.5px; /* overlap borders so the strip reads as one unit */
}
`;
    document.head.appendChild(style);
}

interface ChipEntry {
    readonly el: HTMLDivElement;
    readonly chevronBtn: HTMLButtonElement;
    readonly eyeBtn: HTMLButtonElement;
    /**
     * Last-rendered chevron collapsed state. positionChip() runs on every
     * pan/zoom frame but the chevron glyph only changes on collapse/expand;
     * this lets us skip the innerHTML SVG re-parse when nothing changed.
     */
    chevronCollapsed: boolean | undefined;
}

export function setupFolderHandles(cy: Core): void {
    const container: HTMLElement | null = cy.container();
    if (container === null) return; // headless cy (tests) — no overlay needed

    injectStylesheet();

    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    container.appendChild(overlay);

    const chips: Map<string, ChipEntry> = new Map();
    let folderBodyPan: {lastX: number; lastY: number} | null = null;

    // ---- Folder-note resolution cache ----------------------------------
    const folderNoteCache: Map<string, NodeIdAndFilePath | null> = new Map();
    let cachedGraph: Graph | null = null;

    async function resolveFolderNoteId(folderId: string): Promise<NodeIdAndFilePath | null> {
        const cached: NodeIdAndFilePath | null | undefined = folderNoteCache.get(folderId);
        if (cached !== undefined) return cached;
        cachedGraph ??= (await window.electronAPI?.main.getGraph()) ?? null;
        if (cachedGraph === null) return null;
        const resolved: NodeIdAndFilePath | null = getFolderNotePath(cachedGraph, folderId) ?? null;
        folderNoteCache.set(folderId, resolved);
        return resolved;
    }

    // ---- View-chip hover state machine ---------------------------------
    let viewHoverFolderId: string | null = null;
    let closeTimerId: number | null = null;

    function cancelClose(): void {
        if (closeTimerId !== null) {
            window.clearTimeout(closeTimerId);
            closeTimerId = null;
        }
    }

    function scheduleClose(): void {
        if (closeTimerId !== null) return;
        closeTimerId = window.setTimeout((): void => {
            closeTimerId = null;
            viewHoverFolderId = null;
            closeHoverEditor(cy);
        }, VIEW_HOVER_CLOSE_DEBOUNCE_MS);
    }

    async function openFolderNoteHoverEditor(folder: NodeSingular): Promise<void> {
        const folderNoteId: NodeIdAndFilePath | null = await resolveFolderNoteId(folder.id());
        if (folderNoteId === null) return;
        const eyeBtn: HTMLButtonElement | undefined = chips.get(folder.id())?.eyeBtn;
        // Anchor the editor to the chip strip (folder bbox TL), not folder.position().
        // For a collapsed pill, position() ≈ bbox center ≈ strip — they coincide.
        // For an expanded compound, position() is the centroid of all descendants,
        // which floats in the middle of the folder body, far from the chip strip in
        // the TL corner. Using bbox TL keeps the editor pinned just-below-strip in
        // both states. Strip is 44×22 graph units (CHIP_PX=22 × two chips, scaled
        // by zoom in CSS so size matches across zooms).
        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = folder.boundingBox();
        const stripAnchor: cytoscape.Position = {
            x: bbox.x1 + CHIP_PX,  // strip horizontal center (half of 44 wide strip)
            y: bbox.y1 + CHIP_PX,  // strip bottom edge (22 tall)
        };
        await openHoverEditor(cy, folderNoteId, stripAnchor, (mx, my, editorWindow) => {
            // Tight hover zone: eye chip DOM OR editor DOM (not the whole
            // folder bbox). When the user moves off the chip the editor
            // should close unless they're heading into it.
            const at: Element | null = document.elementFromPoint(mx, my);
            if (at === null) return false;
            if (editorWindow !== null && editorWindow.contains(at)) return true;
            if (eyeBtn !== undefined && eyeBtn.contains(at)) return true;
            return false;
        });

        // Cancel any pending close when the cursor actually reaches the editor.
        const editorOpt = getHoverEditor();
        if (O.isSome(editorOpt) && editorOpt.value.ui !== undefined) {
            editorOpt.value.ui.windowElement.addEventListener('mouseenter', cancelClose);
        }
    }

    // ---- Chip lifecycle ------------------------------------------------
    function createChip(folderId: string): void {
        if (chips.has(folderId)) return;

        const el: HTMLDivElement = document.createElement('div');
        el.className = CHIP_CLASS;
        el.dataset.folderId = folderId;

        const chevronBtn: HTMLButtonElement = document.createElement('button');
        chevronBtn.type = 'button';
        chevronBtn.className = BUTTON_CHEVRON_CLASS;
        chevronBtn.setAttribute('aria-label', 'Toggle folder');
        chevronBtn.addEventListener('click', (evt: MouseEvent): void => {
            evt.stopPropagation();
            evt.preventDefault();
            void toggleFolderCollapse(cy, folderId);
        });

        const eyeBtn: HTMLButtonElement = document.createElement('button');
        eyeBtn.type = 'button';
        eyeBtn.className = BUTTON_EYE_CLASS;
        eyeBtn.setAttribute('aria-label', 'View folder note');
        eyeBtn.innerHTML = EYE_SVG;
        eyeBtn.addEventListener('click', (evt: MouseEvent): void => {
            evt.stopPropagation();
            evt.preventDefault();
            const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
            if (node.length === 0) return;
            cancelClose();
            viewHoverFolderId = folderId;
            void openFolderNoteHoverEditor(node as NodeSingular);
        });
        eyeBtn.addEventListener('mouseenter', (): void => {
            const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
            if (node.length === 0) return;
            cancelClose();
            if (viewHoverFolderId === folderId) return;
            viewHoverFolderId = folderId;
            void openFolderNoteHoverEditor(node as NodeSingular);
        });
        eyeBtn.addEventListener('mouseleave', (): void => {
            if (viewHoverFolderId !== null) scheduleClose();
        });

        el.appendChild(chevronBtn);
        el.appendChild(eyeBtn);
        overlay.appendChild(el);
        chips.set(folderId, {el, chevronBtn, eyeBtn, chevronCollapsed: undefined});
        positionChip(folderId);
    }

    function destroyChip(folderId: string): void {
        const entry: ChipEntry | undefined = chips.get(folderId);
        if (entry === undefined) return;
        entry.el.remove();
        chips.delete(folderId);
    }

    function positionChip(folderId: string): void {
        const entry: ChipEntry | undefined = chips.get(folderId);
        if (entry === undefined) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;

        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = (node as NodeSingular).renderedBoundingBox();
        // Anchor strip to TL of the bbox. Container is the cy host; chip is a
        // child of the overlay (sibling-positioned), so direct canvas coords
        // map 1:1 onto offset coords.
        entry.el.style.left = `${bbox.x1}px`;
        entry.el.style.top = `${bbox.y1}px`;

        // Scale chips with cy.zoom() so the strip stays visually proportional
        // to the folder node (otherwise chips look oversized when zoomed out
        // and tiny when zoomed in). Same pattern as headless-badge-overlay.
        // Origin "0 0" keeps the TL corner pinned to the bbox TL.
        const zoom: number = cy.zoom();
        entry.el.style.transform = `scale(${zoom})`;
        entry.el.style.transformOrigin = '0 0';

        // Chevron glyph reflects state: down (expanded — "click to collapse"),
        // right (collapsed — "click to expand"). Setting innerHTML re-parses the
        // SVG; positionChip runs every pan/zoom frame, so only rewrite the glyph
        // when the collapsed state actually changed.
        const isCollapsed: boolean = (node as NodeSingular).data('collapsed') === true;
        if (entry.chevronCollapsed !== isCollapsed) {
            entry.chevronBtn.innerHTML = isCollapsed ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG;
            entry.chevronCollapsed = isCollapsed;
        }
    }

    function positionAllChips(): void {
        for (const folderId of chips.keys()) positionChip(folderId);
    }

    function scheduleChipPositionAfterRender(folderId: string): void {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                positionChip(folderId);
            });
        });
    }

    function scheduleAllChipPositionsAfterRender(): void {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(positionAllChips);
        });
    }

    // Bootstrap: chip for every folder already in the graph
    cy.nodes('node[?isFolderNode]').forEach((n: NodeSingular): void => {
        createChip(n.id());
    });

    // Lifecycle: add / remove folder nodes
    cy.on('add', 'node[?isFolderNode]', (evt: EventObject): void => {
        createChip((evt.target as NodeSingular).id());
    });
    cy.on('remove', 'node[?isFolderNode]', (evt: EventObject): void => {
        destroyChip((evt.target as NodeSingular).id());
    });

    // Data change: collapse / expand toggle → re-render chevron glyph + reposition.
    // Cytoscape compound bounds settle after the batch/render turn that removes
    // or restores descendants, so read renderedBoundingBox again after rAF x2.
    cy.on('data', 'node[?isFolderNode]', (evt: EventObject): void => {
        const folderId: string = (evt.target as NodeSingular).id();
        positionChip(folderId);
        scheduleChipPositionAfterRender(folderId);
    });

    cy.on('layoutstop', scheduleAllChipPositionsAfterRender);

    // Reposition on pan / zoom (canvas-relative move). Per-node moves handled
    // by 'position' listeners below. NEVER subscribe to 'bounds' or 'render'
    // — both create runaway loops: cy's boundingBox() internally emits
    // 'bounds', and positionChip() calls renderedBoundingBox(), so a 'bounds'
    // listener re-enters positionChip until the stack blows.
    cy.on('pan zoom', positionAllChips);
    cy.on('position', 'node[?isFolderNode]', (evt: EventObject): void => {
        positionChip((evt.target as NodeSingular).id());
    });
    // Compound bbox changes when children move — chip position depends on
    // child layout, so listen for child position changes that belong to a
    // folder parent.
    cy.on('position', 'node', (evt: EventObject): void => {
        const parent: cytoscape.CollectionReturnValue = (evt.target as NodeSingular).parent();
        if (parent.length === 0) return;
        if ((parent[0] as NodeSingular).data('isFolderNode') !== true) return;
        positionChip((parent[0] as NodeSingular).id());
    });

    // ---- Existing folder-body pan loop ---------------------------------
    cy.on('mousedown', 'node[?isFolderNode]', (evt: EventObject): void => {
        const node: NodeSingular = evt.target as NodeSingular;
        if (node.data('collapsed') === true) return;

        const start: MousePosition | null = mousePositionFromEvent(evt.originalEvent);
        if (start === null || start.button !== 0) return;

        // Defer to cytoscape's native box-selection when a multi-select key
        // is held (shift/meta/ctrl). Installing our capture-phase mousemove
        // listener would stopPropagation() before cytoscape's load-listeners
        // see the move, so box-select inside an expanded folder would never
        // start. See cytoscape/src/extensions/renderer/base/load-listeners.mjs
        // (isMultSelKeyDown).
        if (start.shiftKey || start.metaKey || start.ctrlKey) return;

        folderBodyPan = {lastX: start.clientX, lastY: start.clientY};
        window.addEventListener('mousemove', handleFolderBodyPanMove, {capture: true});
        window.addEventListener('mouseup', handleFolderBodyPanEnd, {capture: true, once: true});
        evt.originalEvent?.preventDefault();
    });

    function handleFolderBodyPanMove(evt: MouseEvent): void {
        if (folderBodyPan === null) return;

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
    readonly shiftKey: boolean;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
}

function mousePositionFromEvent(evt: Event | undefined): MousePosition | null {
    if (!(evt instanceof MouseEvent)) return null;
    return {
        clientX: evt.clientX,
        clientY: evt.clientY,
        button: evt.button,
        shiftKey: evt.shiftKey,
        metaKey: evt.metaKey,
        ctrlKey: evt.ctrlKey,
    };
}
