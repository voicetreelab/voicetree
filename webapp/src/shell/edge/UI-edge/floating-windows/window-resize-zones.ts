/** Resize zone size in pixels - larger for easier targeting */
const RESIZE_ZONE_SIZE: number = 15;

/** Minimum window dimensions during resize */
const MIN_WIDTH: number = 300;
const MIN_HEIGHT: number = 200;

/**
 * Add invisible resize zones to all 4 edges and 4 corners of a window (Phase 2C)
 * Each zone has appropriate cursor styling and mousedown handlers for resizing
 */
export function addResizeZones(windowElement: HTMLDivElement): void {
    // Edge zones
    const topZone: HTMLDivElement = createEdgeResizeZone('top', 'ns-resize');
    const bottomZone: HTMLDivElement = createEdgeResizeZone('bottom', 'ns-resize');
    const leftZone: HTMLDivElement = createEdgeResizeZone('left', 'ew-resize');
    const rightZone: HTMLDivElement = createEdgeResizeZone('right', 'ew-resize');

    // Corner zones
    const nwCorner: HTMLDivElement = createCornerResizeZone('nw', 'nwse-resize');
    const neCorner: HTMLDivElement = createCornerResizeZone('ne', 'nesw-resize');
    const swCorner: HTMLDivElement = createCornerResizeZone('sw', 'nesw-resize');
    const seCorner: HTMLDivElement = createCornerResizeZone('se', 'nwse-resize');

    // Add resize handlers
    setupEdgeResizeHandler(topZone, windowElement, 'top');
    setupEdgeResizeHandler(bottomZone, windowElement, 'bottom');
    setupEdgeResizeHandler(leftZone, windowElement, 'left');
    setupEdgeResizeHandler(rightZone, windowElement, 'right');

    setupCornerResizeHandler(nwCorner, windowElement, 'nw');
    setupCornerResizeHandler(neCorner, windowElement, 'ne');
    setupCornerResizeHandler(swCorner, windowElement, 'sw');
    setupCornerResizeHandler(seCorner, windowElement, 'se');

    // Append all zones to window
    windowElement.appendChild(topZone);
    windowElement.appendChild(bottomZone);
    windowElement.appendChild(leftZone);
    windowElement.appendChild(rightZone);
    windowElement.appendChild(nwCorner);
    windowElement.appendChild(neCorner);
    windowElement.appendChild(swCorner);
    windowElement.appendChild(seCorner);
}

/**
 * Create an edge resize zone with proper positioning and cursor
 */
function createEdgeResizeZone(
    edge: 'top' | 'bottom' | 'left' | 'right',
    cursor: 'ns-resize' | 'ew-resize'
): HTMLDivElement {
    const zone: HTMLDivElement = document.createElement('div');
    zone.className = `resize-zone-${edge}`;
    zone.style.position = 'absolute';
    zone.style.cursor = cursor;

    // Position based on edge
    if (edge === 'top') {
        zone.style.top = '0px';
        zone.style.left = '0px';
        zone.style.right = '0px';
        zone.style.height = `${RESIZE_ZONE_SIZE}px`;
    } else if (edge === 'bottom') {
        zone.style.bottom = '0px';
        zone.style.left = '0px';
        zone.style.right = '0px';
        zone.style.height = `${RESIZE_ZONE_SIZE}px`;
    } else if (edge === 'left') {
        zone.style.left = '0px';
        zone.style.top = '0px';
        zone.style.bottom = '0px';
        zone.style.width = `${RESIZE_ZONE_SIZE}px`;
    } else {
        // right - positioned outside window bounds to avoid scrollbar overlap
        zone.style.right = `-${RESIZE_ZONE_SIZE}px`;
        zone.style.top = '0px';
        zone.style.bottom = '0px';
        zone.style.width = `${RESIZE_ZONE_SIZE}px`;
    }

    return zone;
}

/**
 * Create a corner resize zone with proper positioning and cursor
 */
function createCornerResizeZone(
    corner: 'nw' | 'ne' | 'sw' | 'se',
    cursor: 'nwse-resize' | 'nesw-resize'
): HTMLDivElement {
    const zone: HTMLDivElement = document.createElement('div');
    zone.className = `resize-zone-corner-${corner}`;
    zone.style.position = 'absolute';
    zone.style.cursor = cursor;
    zone.style.width = `${RESIZE_ZONE_SIZE * 2}px`;
    zone.style.height = `${RESIZE_ZONE_SIZE * 2}px`;
    zone.style.zIndex = '1'; // Above edge zones

    // Position based on corner
    if (corner === 'nw') {
        zone.style.top = '0px';
        zone.style.left = '0px';
    } else if (corner === 'ne') {
        // Offset right to avoid scrollbar overlap
        zone.style.top = '0px';
        zone.style.right = `-${RESIZE_ZONE_SIZE}px`;
    } else if (corner === 'sw') {
        zone.style.bottom = '0px';
        zone.style.left = '0px';
    } else {
        // se - Offset right to avoid scrollbar overlap
        zone.style.bottom = '0px';
        zone.style.right = `-${RESIZE_ZONE_SIZE}px`;
    }

    return zone;
}

/**
 * Setup mousedown handler for edge resize
 */
function setupEdgeResizeHandler(
    zone: HTMLDivElement,
    windowElement: HTMLDivElement,
    edge: 'top' | 'bottom' | 'left' | 'right'
): void {
    zone.addEventListener('mousedown', (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        const startX: number = e.clientX;
        const startY: number = e.clientY;
        const startWidth: number = windowElement.offsetWidth;
        const startHeight: number = windowElement.offsetHeight;
        const startLeft: number = windowElement.offsetLeft;
        const startTop: number = windowElement.offsetTop;

        const onMouseMove: (moveEvent: MouseEvent) => void = (moveEvent: MouseEvent): void => {
            const deltaX: number = moveEvent.clientX - startX;
            const deltaY: number = moveEvent.clientY - startY;

            if (edge === 'right') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth + deltaX);
                windowElement.style.width = `${newWidth}px`;
            } else if (edge === 'left') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth - deltaX);
                if (newWidth > MIN_WIDTH || deltaX < 0) {
                    windowElement.style.width = `${newWidth}px`;
                    windowElement.style.left = `${startLeft + (startWidth - newWidth)}px`;
                }
            } else if (edge === 'bottom') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight + deltaY);
                windowElement.style.height = `${newHeight}px`;
            } else if (edge === 'top') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight - deltaY);
                if (newHeight > MIN_HEIGHT || deltaY < 0) {
                    windowElement.style.height = `${newHeight}px`;
                    windowElement.style.top = `${startTop + (startHeight - newHeight)}px`;
                }
            }
        };

        const onMouseUp: () => void = (): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

/**
 * Setup mousedown handler for corner resize (both dimensions)
 */
function setupCornerResizeHandler(
    zone: HTMLDivElement,
    windowElement: HTMLDivElement,
    corner: 'nw' | 'ne' | 'sw' | 'se'
): void {
    zone.addEventListener('mousedown', (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        const startX: number = e.clientX;
        const startY: number = e.clientY;
        const startWidth: number = windowElement.offsetWidth;
        const startHeight: number = windowElement.offsetHeight;
        const startLeft: number = windowElement.offsetLeft;
        const startTop: number = windowElement.offsetTop;

        const onMouseMove: (moveEvent: MouseEvent) => void = (moveEvent: MouseEvent): void => {
            const deltaX: number = moveEvent.clientX - startX;
            const deltaY: number = moveEvent.clientY - startY;

            // Handle width based on corner
            if (corner === 'ne' || corner === 'se') {
                const newWidth: number = Math.max(MIN_WIDTH, startWidth + deltaX);
                windowElement.style.width = `${newWidth}px`;
            } else {
                // nw or sw - resize from left edge
                const newWidth: number = Math.max(MIN_WIDTH, startWidth - deltaX);
                if (newWidth > MIN_WIDTH || deltaX < 0) {
                    windowElement.style.width = `${newWidth}px`;
                    windowElement.style.left = `${startLeft + (startWidth - newWidth)}px`;
                }
            }

            // Handle height based on corner
            if (corner === 'sw' || corner === 'se') {
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight + deltaY);
                windowElement.style.height = `${newHeight}px`;
            } else {
                // nw or ne - resize from top edge
                const newHeight: number = Math.max(MIN_HEIGHT, startHeight - deltaY);
                if (newHeight > MIN_HEIGHT || deltaY < 0) {
                    windowElement.style.height = `${newHeight}px`;
                    windowElement.style.top = `${startTop + (startHeight - newHeight)}px`;
                }
            }
        };

        const onMouseUp: () => void = (): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}
