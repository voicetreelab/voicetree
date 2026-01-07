import {CodeMirrorEditorView} from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";
// =============================================================================
// Auto-Height Constants
// =============================================================================

const AUTO_HEIGHT_MIN: number = 200;
const AUTO_HEIGHT_MAX: number = 400; // Current default height
const AUTO_HEIGHT_DEBOUNCE_MS: number = 50;


/**
 * Setup auto-height behavior for an editor window
 * Adjusts window height based on content, respecting min/max bounds
 */
export function setupAutoHeight(
    windowElement: HTMLElement,
    editor: CodeMirrorEditorView
): () => void {
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
    // Title bar height (approx 32px) + padding (approx 16px)
    const CHROME_HEIGHT: number = 48;

    const updateHeight: () => void = (): void => {
        // Use CodeMirror's actual content height, not container scrollHeight
        const contentHeight: number = editor.getContentHeight() + CHROME_HEIGHT;
        const totalHeight: number = Math.min(
            Math.max(contentHeight, AUTO_HEIGHT_MIN),
            AUTO_HEIGHT_MAX
        );
        windowElement.style.height = `${totalHeight}px`;
    };

    const unsubscribe: () => void = editor.onChange((): void => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(updateHeight, AUTO_HEIGHT_DEBOUNCE_MS);
    });

    // Initial height adjustment
    requestAnimationFrame(updateHeight);

    return (): void => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        unsubscribe();
    };
}