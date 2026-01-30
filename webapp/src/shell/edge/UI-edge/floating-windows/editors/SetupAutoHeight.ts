import {CodeMirrorEditorView} from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";
// =============================================================================
// Auto-Height Constants
// =============================================================================

const AUTO_HEIGHT_MIN: number = 200;
const AUTO_HEIGHT_MAX: number = 500;


/**
 * Setup auto-height behavior for an editor window
 * Adjusts window height based on content, respecting min/max bounds
 *
 * Listens to both geometryChange (fires after layout) and docChange (reliable on every edit).
 * Uses DOM measurement for accurate content height.
 */
export function setupAutoHeight(
    windowElement: HTMLElement,
    editor: CodeMirrorEditorView
): () => void {
    // Title bar height (approx 32px) + padding (approx 16px)
    const CHROME_HEIGHT: number = 48;
    // Minimum height change to trigger update (prevents flicker from micro-adjustments)
    const HEIGHT_CHANGE_THRESHOLD: number = 5;
    // Debounce delay for doc change updates (ms)
    const DOC_CHANGE_DEBOUNCE: number = 50;

    let currentHeight: number = 0;
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateHeight: () => void = (): void => {
        const editorContentHeight: number = editor.getContentHeight();
        const contentHeight: number = editorContentHeight + CHROME_HEIGHT;
        const totalHeight: number = Math.min(
            Math.max(contentHeight, AUTO_HEIGHT_MIN),
            AUTO_HEIGHT_MAX
        );
        // Only update if change is meaningful (prevents flicker)
        if (Math.abs(totalHeight - currentHeight) > HEIGHT_CHANGE_THRESHOLD) {
            currentHeight = totalHeight;
            windowElement.style.height = `${totalHeight}px`;
        }
    };

    // Subscribe to geometry changes - fires after CodeMirror layout is complete
    const unsubGeometry: () => void = editor.onGeometryChange(updateHeight);

    // Subscribe to doc changes - fires reliably on every content change
    // geometryChanged doesn't always fire for every keystroke, so we need this too
    // Double RAF ensures CodeMirror has completed its layout cycle before we read contentHeight
    const unsubDoc: () => void = editor.onAnyDocChange((): void => {
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        debounceTimeout = setTimeout((): void => {
            requestAnimationFrame((): void => {
                requestAnimationFrame(updateHeight);
            });
            debounceTimeout = null;
        }, DOC_CHANGE_DEBOUNCE);
    });

    // Initial height adjustment
    requestAnimationFrame(updateHeight);

    return (): void => {
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        unsubGeometry();
        unsubDoc();
    };
}