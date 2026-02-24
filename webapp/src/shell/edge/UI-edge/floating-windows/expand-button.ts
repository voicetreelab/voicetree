import {Maximize2, Minimize2, createElement} from 'lucide';

/** Where the expand button is placed: bottom-left overlay (editors) or inside the title bar (terminals) */
export type ExpandButtonPlacement = 'overlay' | 'title-bar';

/**
 * Create the expand/minimize button
 * Toggles between 2x and 0.5x of current dimensions
 *
 * @param placement - 'overlay' (default): absolutely positioned at bottom-left.
 *                    'title-bar': inline flex item for use inside a title bar.
 */
export function createExpandButton(
    windowElement: HTMLDivElement,
    _baseDimensions: { width: number; height: number },
    placement: ExpandButtonPlacement = 'overlay'
): HTMLButtonElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.className = 'cy-floating-window-expand-corner';
    button.dataset.icon = 'maximize';
    button.dataset.expanded = 'false';
    button.dataset.placement = placement;

    // Only apply absolute positioning for the overlay (bottom-left) variant.
    // Title-bar placement is handled entirely by CSS (static position, flex item).
    if (placement === 'overlay') {
        button.style.position = 'absolute';
        button.style.bottom = '0';
        button.style.left = '0';
    }

    // Create and append initial icon (Maximize2)
    const initialIcon: SVGElement = createElement(Maximize2);
    initialIcon.setAttribute('width', '16');
    initialIcon.setAttribute('height', '16');
    button.appendChild(initialIcon);

    // Click handler: in hover-edit mode, request pinning; in pinned mode, expand/minimize toggle
    button.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();

        // In hover-edit mode, the expand button triggers pinning (same action as double-click)
        if (windowElement.classList.contains('mode-edit')) {
            windowElement.dispatchEvent(new CustomEvent('expand-button-pin-request', { bubbles: false }));
            return;
        }

        const isExpanded: boolean = windowElement.dataset.expanded === 'true';
        // Get current actual dimensions (accounts for zoom scaling, user resizes, etc.)
        // Fall back to parsing style.width/height for JSDOM tests where offsetWidth returns 0
        const currentWidth: number = windowElement.offsetWidth || parseInt(windowElement.style.width, 10) || 0;
        const currentHeight: number = windowElement.offsetHeight || parseInt(windowElement.style.height, 10) || 0;

        if (isExpanded) {
            // Minimize: shrink current dimensions by half (0.5x)
            windowElement.style.width = `${currentWidth / 2}px`;
            windowElement.style.height = `${currentHeight / 2}px`;
            windowElement.dataset.expanded = 'false';
            button.dataset.expanded = 'false';
            button.dataset.icon = 'maximize';

            // Swap icon to Maximize2
            button.innerHTML = '';
            const maximizeIcon: SVGElement = createElement(Maximize2);
            maximizeIcon.setAttribute('width', '16');
            maximizeIcon.setAttribute('height', '16');
            button.appendChild(maximizeIcon);
        } else {
            // Expand: grow current dimensions by 2x
            windowElement.style.width = `${currentWidth * 2}px`;
            windowElement.style.height = `${currentHeight * 2}px`;
            windowElement.dataset.expanded = 'true';
            button.dataset.expanded = 'true';
            button.dataset.icon = 'minimize';

            // Swap icon to Minimize2
            button.innerHTML = '';
            const minimizeIcon: SVGElement = createElement(Minimize2);
            minimizeIcon.setAttribute('width', '16');
            minimizeIcon.setAttribute('height', '16');
            button.appendChild(minimizeIcon);
        }
    });

    return button;
}
