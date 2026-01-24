/**
 * Hover-to-scroll carousel effect for text overflow
 *
 * When text overflows its container, hovering will trigger an animation
 * that scrolls the text horizontally to reveal the full content.
 * Includes a mini scrollbar indicator showing scroll progress.
 */

const SCROLL_SPEED_PX_PER_SEC: number = 50;
const PADDING_PX: number = 8;

/**
 * Creates a mini scrollbar indicator element for showing scroll progress.
 * Returns the indicator container with track and thumb.
 */
function createScrollIndicator(thumbWidthPercent: number): HTMLDivElement {
    const indicator: HTMLDivElement = document.createElement('div');
    indicator.className = 'scroll-indicator';

    const thumb: HTMLDivElement = document.createElement('div');
    thumb.className = 'scroll-indicator-thumb';
    thumb.style.width = `${thumbWidthPercent}%`;

    // Calculate how far thumb needs to travel (as percentage of thumb width for translateX)
    // If thumb is 40% of track, it needs to move 60% of track width = 150% of thumb width
    const thumbTravelPercent: number = ((100 - thumbWidthPercent) / thumbWidthPercent) * 100;
    thumb.style.setProperty('--thumb-travel', `${thumbTravelPercent}%`);

    indicator.appendChild(thumb);
    return indicator;
}

/**
 * Sets up hover scroll behavior on a text element.
 * On hover, if text overflows, it will animate to show full content.
 * Shows a mini scrollbar indicator when text overflows.
 *
 * @param textSpan - The text span element to setup (must have width: max-content, white-space: nowrap)
 */
export function setupHoverScroll(textSpan: HTMLSpanElement): void {
    textSpan.addEventListener('mouseenter', () => {
        const parent: HTMLElement | null = textSpan.parentElement;
        if (!parent) return;

        // Text span has width: max-content (full text width), parent clips it
        const textWidth: number = textSpan.offsetWidth;
        const containerWidth: number = parent.clientWidth;

        // Check if text overflows the parent container
        if (textWidth > containerWidth) {
            const overflow: number = textWidth - containerWidth + PADDING_PX;
            const duration: number = overflow / SCROLL_SPEED_PX_PER_SEC;

            // Calculate thumb width as percentage of visible content
            const thumbWidthPercent: number = (containerWidth / textWidth) * 100;

            // Create and add scroll indicator
            const indicator: HTMLDivElement = createScrollIndicator(thumbWidthPercent);
            indicator.style.setProperty('--scroll-duration', `${duration}s`);
            parent.appendChild(indicator);

            textSpan.style.setProperty('--overflow-amount', `-${overflow}px`);
            textSpan.style.setProperty('--scroll-duration', `${duration}s`);
            textSpan.classList.add('scrolling');
        }
    });

    textSpan.addEventListener('mouseleave', () => {
        textSpan.classList.remove('scrolling');

        // Remove scroll indicator by querying for it
        const parent: HTMLElement | null = textSpan.parentElement;
        const indicator: HTMLDivElement | null = parent?.querySelector('.scroll-indicator') ?? null;
        if (indicator) {
            indicator.remove();
        }
    });
}
