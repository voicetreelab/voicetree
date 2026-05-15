/**
 * FolderHandleService — DOM-overlay chip at the top-left corner of every
 * expanded folder compound. The chip carries the collapse/expand affordance
 * (chevron click) so the folder body can stay input-inert (ungrabified) and
 * still expose pan + right-click + hover-editor on the canvas underneath.
 *
 * The collapsed folder (40x40 cy pill) does NOT get a DOM chip — the cy node
 * itself is the visual chip in that state.
 *
 * Lifecycle:
 *   - `setupFolderHandles(cy, container)` is the only export. Call once after
 *     cy + container are initialized. Returns void; cleanup is implicit via
 *     cy event handlers (no explicit destroy needed today).
 *
 *   - On folder `add`: create chip and append to overlay container.
 *   - On folder `remove`: destroy chip.
 *   - On folder data change (`collapsed` toggle): hide chip if collapsed.
 *   - On pan / zoom / position: reposition all chips via `renderedBoundingBox`.
 *
 * Pointer events:
 *   - Chip body has `pointer-events: none` so cy mouseover still reaches the
 *     folder underneath (preserves setupCommandHover → hover editor for free).
 *   - Chevron has `pointer-events: auto` for the click handler only.
 */
import type {Core, EventObject, NodeSingular} from 'cytoscape';
import type cytoscape from 'cytoscape';
import {toggleFolderCollapse} from '@/shell/edge/UI-edge/graph/view/folderCollapse';

const CHIP_CLASS = 'vt-folder-handle';
const CHEVRON_CLASS = 'vt-folder-handle__chevron';

interface ChipEntry {
    el: HTMLDivElement;
    chevron: HTMLDivElement;
}

export function setupFolderHandles(cy: Core, container: HTMLElement): void {
    injectStylesheet();

    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = 'vt-folder-handle-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
    // Container is the cy canvas host; appending makes overlay a positioned
    // sibling so absolute children align to its 0,0.
    container.appendChild(overlay);

    const chips: Map<string, ChipEntry> = new Map();

    function createChip(folderId: string): void {
        if (chips.has(folderId)) return;

        const el: HTMLDivElement = document.createElement('div');
        el.className = CHIP_CLASS;
        el.dataset.folderId = folderId;

        const chevron: HTMLDivElement = document.createElement('div');
        chevron.className = CHEVRON_CLASS;
        chevron.setAttribute('aria-label', 'Collapse folder');
        chevron.setAttribute('role', 'button');
        chevron.innerHTML =
            '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">' +
            '<path d="M2 3 L5 7 L8 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>';
        chevron.addEventListener('click', (evt: MouseEvent): void => {
            evt.stopPropagation();
            evt.preventDefault();
            void toggleFolderCollapse(cy, folderId);
        });

        el.appendChild(chevron);
        overlay.appendChild(el);
        chips.set(folderId, {el, chevron});
        positionChip(folderId);
    }

    function destroyChip(folderId: string): void {
        const entry: ChipEntry | undefined = chips.get(folderId);
        if (!entry) return;
        entry.el.remove();
        chips.delete(folderId);
    }

    function positionChip(folderId: string): void {
        const entry: ChipEntry | undefined = chips.get(folderId);
        if (!entry) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;

        const isCollapsed: boolean = node.data('collapsed') === true;
        // Hide chip when collapsed — cy pill is the visual chip in that state.
        if (isCollapsed) {
            entry.el.style.display = 'none';
            return;
        }
        entry.el.style.display = '';

        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = node.renderedBoundingBox();
        // Anchor to top-left of the rendered bbox. Cy returns coords relative to
        // the canvas — overlay is a sibling positioned at 0,0 of the same
        // container, so direct coords align.
        entry.el.style.left = `${bbox.x1}px`;
        entry.el.style.top = `${bbox.y1}px`;
    }

    function positionAllChips(): void {
        for (const folderId of chips.keys()) positionChip(folderId);
    }

    // Bootstrap: chip for every folder already in the graph
    cy.nodes('node[?isFolderNode]').forEach((n: NodeSingular): void => {
        createChip(n.id());
    });

    // Lifecycle: add / remove folder nodes
    cy.on('add', 'node[?isFolderNode]', (evt: EventObject): void => {
        createChip(evt.target.id());
    });
    cy.on('remove', 'node[?isFolderNode]', (evt: EventObject): void => {
        destroyChip(evt.target.id());
    });

    // Data change: collapse / expand toggle
    cy.on('data', 'node[?isFolderNode]', (evt: EventObject): void => {
        positionChip(evt.target.id());
    });

    // Reposition on pan / zoom (canvas-relative move). Per-node moves are
    // handled by the 'position bounds' listeners below. NEVER subscribe to
    // 'render' — it fires every repaint frame and creates a runaway loop
    // because each positionChip() writes style.left/top, which triggers
    // layout, which triggers another render.
    cy.on('pan zoom', positionAllChips);
    cy.on('position bounds', 'node[?isFolderNode]', (evt: EventObject): void => {
        positionChip(evt.target.id());
    });
    // Compound bbox changes when children move — listen to children-of-folder positions too.
    cy.on('position bounds', 'node', (evt: EventObject): void => {
        const parent: cytoscape.CollectionReturnValue = evt.target.parent();
        if (parent.length === 0) return;
        if (parent.data('isFolderNode') !== true) return;
        positionChip(parent.id());
    });
}

let stylesInjected: boolean = false;
function injectStylesheet(): void {
    if (stylesInjected) return;
    stylesInjected = true;
    const style: HTMLStyleElement = document.createElement('style');
    style.textContent = `
.vt-folder-handle {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  pointer-events: none;
  user-select: none;
  z-index: 1;
  transform: translate(-1px, -1px);
}
.vt-folder-handle__chevron {
  pointer-events: auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  background: rgba(45, 45, 48, 0.92);
  border: 1.5px solid #888;
  border-radius: 12px 0 8px 0;
  color: #d4d4d4;
  cursor: pointer;
  transition: background-color 120ms;
}
.vt-folder-handle__chevron:hover {
  background: rgba(56, 56, 56, 0.96);
}
.vt-folder-handle__chevron svg {
  display: block;
}
`;
    document.head.appendChild(style);
}
