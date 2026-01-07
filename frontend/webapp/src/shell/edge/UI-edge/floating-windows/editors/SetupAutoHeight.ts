import {CodeMirrorEditorView} from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";
// =============================================================================
// Auto-Height Constants
// =============================================================================

const AUTO_HEIGHT_MIN: number = 200;
const AUTO_HEIGHT_MAX: number = 400; // Current default height


/**
 * Setup auto-height behavior for an editor window
 * Adjusts window height based on content, respecting min/max bounds
 *
 * Uses onGeometryChange which fires AFTER CodeMirror has recalculated layout.
 * This ensures contentHeight is accurate (no timing/race conditions).
 */
export function setupAutoHeight(
    windowElement: HTMLElement,
    editor: CodeMirrorEditorView
): () => void {
    // Title bar height (approx 32px) + padding (approx 16px)
    const CHROME_HEIGHT: number = 48;

    const updateHeight: () => void = (): void => {
        // Use CodeMirror's actual content height - guaranteed accurate after geometryChanged
        const contentHeight: number = editor.getContentHeight() + CHROME_HEIGHT;
        const totalHeight: number = Math.min(
            Math.max(contentHeight, AUTO_HEIGHT_MIN),
            AUTO_HEIGHT_MAX
        );
        windowElement.style.height = `${totalHeight}px`;
    };

    // Subscribe to geometry changes - fires after CodeMirror layout is complete
    // No debounce needed since CodeMirror batches updates internally
    const unsubscribe: () => void = editor.onGeometryChange(updateHeight);

    // Initial height adjustment
    requestAnimationFrame(updateHeight);

    return unsubscribe;
}