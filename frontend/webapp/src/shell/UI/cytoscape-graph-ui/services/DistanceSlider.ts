/**
 * Distance slider module for selecting context-retrieval distance.
 * Used by horizontal menu to show a floating slider above run buttons.
 */

/** Slider config */
const SLIDER_SQUARE_COUNT: number = 10;
const SLIDER_SQUARE_SIZE: number = 12;
const SLIDER_SQUARE_GAP: number = 2;
const SLIDER_GOLD_COLOR: string = 'rgba(251, 191, 36, 0.9)';
const SLIDER_GRAY_COLOR: string = 'rgba(255, 255, 255, 0.2)';

/** Module-level state for floating slider */
let activeSlider: HTMLDivElement | null = null;
let sliderHideTimeout: number | null = null;
let currentMenuElement: HTMLElement | null = null;

/** Options for showing the floating slider */
export interface FloatingSliderOptions {
    readonly menuElement: HTMLElement;        // The menu element to position slider above
    readonly currentDistance: number;
    readonly onDistanceChange: (distance: number) => void;
    readonly onRun?: () => void | Promise<void>;  // Called when user clicks a slider square
}

/**
 * Show the floating distance slider above the menu.
 * Uses position: fixed to escape stacking context issues with floating windows.
 */
export function showFloatingSlider(options: FloatingSliderOptions): void {
    // Clear any pending hide
    if (sliderHideTimeout !== null) {
        clearTimeout(sliderHideTimeout);
        sliderHideTimeout = null;
    }

    // Create slider if needed (appended to body for fixed positioning)
    if (!activeSlider) {
        activeSlider = createDistanceSlider(options.currentDistance, options.onDistanceChange, options.onRun);
        document.body.appendChild(activeSlider);

        // Since slider is not a child of the menu, add hover handlers to keep it visible
        activeSlider.addEventListener('mouseenter', () => {
            if (sliderHideTimeout !== null) {
                clearTimeout(sliderHideTimeout);
                sliderHideTimeout = null;
            }
        });
        activeSlider.addEventListener('mouseleave', () => {
            hideFloatingSlider();
        });
    }

    currentMenuElement = options.menuElement;

    // Position above the menu using fixed positioning
    const rect: DOMRect = options.menuElement.getBoundingClientRect();
    activeSlider.style.left = `${rect.left + rect.width / 2}px`;
    activeSlider.style.top = `${rect.top}px`;

    activeSlider.style.display = 'flex';
}

/**
 * Hide the floating slider with a small delay for mouse transition.
 */
export function hideFloatingSlider(): void {
    sliderHideTimeout = window.setTimeout(() => {
        if (activeSlider) {
            activeSlider.style.display = 'none';
        }
    }, 100); // Small delay for mouse transition
}

/**
 * Remove the floating slider completely from the DOM.
 * Call this when the menu/editor is destroyed.
 */
export function destroyFloatingSlider(): void {
    if (sliderHideTimeout !== null) {
        clearTimeout(sliderHideTimeout);
        sliderHideTimeout = null;
    }
    if (activeSlider) {
        activeSlider.remove();
        activeSlider = null;
    }
}

/**
 * Create a horizontal distance slider with 10 squares.
 * Updates contextNodeMaxDistance setting on hover and triggers preview refresh.
 * Clicking a square also triggers onRun (if provided) to run the agent.
 * @internal Exported for testing only
 */
export function createDistanceSlider(
    currentDistance: number,
    onDistanceChange: (newDistance: number) => void,
    onRun?: () => void | Promise<void>
): HTMLDivElement {
    const container: HTMLDivElement = document.createElement('div');
    container.className = 'distance-slider';
    container.style.cssText = `
        position: fixed;
        transform: translate(-50%, -100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        pointer-events: auto;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 99999;
    `;

    // Add tooltip label above the squares
    const tooltip: HTMLSpanElement = document.createElement('span');
    tooltip.textContent = 'Select context-retrieval distance';
    tooltip.style.cssText = `
        font-size: 11px;
        color: var(--foreground);
        white-space: nowrap;
    `;
    container.appendChild(tooltip);

    // Container for the squares themselves
    const squaresRow: HTMLDivElement = document.createElement('div');
    squaresRow.style.cssText = `
        display: flex;
        gap: ${SLIDER_SQUARE_GAP}px;
        justify-content: center;
    `;

    const squares: HTMLDivElement[] = [];

    // Update visual state of all squares based on distance
    const updateSquares: (distance: number) => void = (distance: number): void => {
        squares.forEach((square, index) => {
            const squareDistance: number = index + 1;
            square.style.background = squareDistance <= distance ? SLIDER_GOLD_COLOR : SLIDER_GRAY_COLOR;
        });
    };

    for (let i: number = 0; i < SLIDER_SQUARE_COUNT; i++) {
        const square: HTMLDivElement = document.createElement('div');
        const squareDistance: number = i + 1;

        square.style.cssText = `
            width: ${SLIDER_SQUARE_SIZE}px;
            height: ${SLIDER_SQUARE_SIZE}px;
            background: ${squareDistance <= currentDistance ? SLIDER_GOLD_COLOR : SLIDER_GRAY_COLOR};
            border: 1px solid var(--muted-foreground);
            cursor: pointer;
            transition: background 0.1s ease;
        `;

        // On hover, update visual and trigger distance change
        square.addEventListener('mouseenter', () => {
            updateSquares(squareDistance);
            onDistanceChange(squareDistance);
        });

        // On click, trigger run action (if provided)
        square.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onRun) {
                void onRun();
            }
        });

        squares.push(square);
        squaresRow.appendChild(square);
    }

    container.appendChild(squaresRow);
    return container;
}
