/**
 * Editor cleanup for node presentation disposal.
 * Simplified: only unmounts CardCM instances (the old floating editor
 * and inline editor paths have been replaced by the CardCM system).
 */
import { unmountCardCM } from './cardCM';

/**
 * Cleanup CardCM instance for a node.
 * Called by destroyNodePresentation.
 */
export function disposeEditor(nodeId: string): void {
    unmountCardCM(nodeId);
}
