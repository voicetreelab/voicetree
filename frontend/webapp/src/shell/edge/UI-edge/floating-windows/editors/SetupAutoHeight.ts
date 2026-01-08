import {CodeMirrorEditorView} from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";
// =============================================================================
// Auto-Height Constants
// =============================================================================

const AUTO_HEIGHT_MIN: number = 200;
const AUTO_HEIGHT_MAX_DEFAULT: number = 400;


/**
 * Setup auto-height behavior for an editor window
 * Adjusts window height based on content, respecting min/max bounds
 *
 * Uses onGeometryChange which fires AFTER CodeMirror has recalculated layout.
 * This ensures contentHeight is accurate (no timing/race conditions).
 *
 * Max height is read from windowElement.dataset.baseHeight, allowing the
 * expand button to increase the max dynamically.
 */
export function setupAutoHeight(
    windowElement: HTMLElement,
    editor: CodeMirrorEditorView
): () => void {
    // Title bar height (approx 32px) + padding (approx 16px)
    const CHROME_HEIGHT: number = 48;
    // Minimum height change to trigger update (prevents flicker from micro-adjustments)
    const HEIGHT_CHANGE_THRESHOLD: number = 5;

    let currentHeight: number = 0;

    const updateHeight: () => void = (): void => {
        // Read max from dataset (allows expand button to change it dynamically)
        const maxHeight: number = parseFloat(windowElement.dataset.baseHeight ?? String(AUTO_HEIGHT_MAX_DEFAULT));
        // Use CodeMirror's actual content height - guaranteed accurate after geometryChanged
        const contentHeight: number = editor.getContentHeight() + CHROME_HEIGHT;
        const totalHeight: number = Math.min(
            Math.max(contentHeight, AUTO_HEIGHT_MIN),
            maxHeight
        );
        // Only update if change is meaningful (prevents flicker)
        if (Math.abs(totalHeight - currentHeight) > HEIGHT_CHANGE_THRESHOLD) {
            currentHeight = totalHeight;
            windowElement.style.height = `${totalHeight}px`;
        }
    };

    // Subscribe to geometry changes - fires after CodeMirror layout is complete
    // No debounce needed since CodeMirror batches updates internally
    const unsubscribe: () => void = editor.onGeometryChange(updateHeight);

    // Initial height adjustment
    requestAnimationFrame(updateHeight);

    return unsubscribe;
}