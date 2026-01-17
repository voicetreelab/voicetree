// Re-export types for consumers (Phase 5 complete - all types from types-v2)
export type { EditorId, TerminalId } from "@/shell/edge/UI-edge/floating-windows/types";
export {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
export {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

// =============================================================================
// Editors State (NEW - uses types-v2)
// =============================================================================



// =============================================================================
// Terminals State (uses types-v2 - Phase 5 complete)
// =============================================================================

// =============================================================================
// Derived Editor Queries
// =============================================================================

// =============================================================================
// Awaiting UI Saved Content (for race condition handling in editor save flow)
// =============================================================================

// =============================================================================
// Legacy: vanillaFloatingWindowInstances (to be removed in Phase 3+)
// =============================================================================

/**
 * @deprecated This will be removed once Phase 3-5 migrate to using ui field in EditorData/TerminalData.
 * The dispose/focus callbacks should be accessed via EditorData.ui.cleanup or TerminalData.ui.cleanup.
 */
export const vanillaFloatingWindowInstances: Map<string, { dispose: () => void; focus?: () => void }> = new Map<string, { dispose: () => void; focus?: () => void }>();

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 * @deprecated Use getEditor/getTerminal and access ui.cleanup instead
 */
export function getVanillaInstance(windowId: string): { dispose: () => void; focus?: () => void } | undefined {
    return vanillaFloatingWindowInstances.get(windowId);
}
