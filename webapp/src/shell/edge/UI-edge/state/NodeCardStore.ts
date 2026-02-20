// Tracks HTML card elements for card-backed nodes
// Cards ARE editors — one DOM element with 3 modes: minimal, hover, full

import type {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';

export type CardMode = 'minimal' | 'hover' | 'full';

export type NodeCardData = {
    readonly windowElement: HTMLElement;
    readonly contentContainer: HTMLElement;
    readonly editorArea: HTMLElement;
    editor: CodeMirrorEditorView | null;
    mode: CardMode;
};

const nodeCards: Map<string, NodeCardData> = new Map();

export function getNodeCard(nodeId: string): NodeCardData | undefined {
    return nodeCards.get(nodeId);
}

export function addNodeCard(nodeId: string, card: NodeCardData): void {
    nodeCards.set(nodeId, card);
}

export function removeNodeCard(nodeId: string): void {
    nodeCards.delete(nodeId);
}

export function hasNodeCard(nodeId: string): boolean {
    return nodeCards.has(nodeId);
}

export function getCardMode(nodeId: string): CardMode {
    return nodeCards.get(nodeId)?.mode ?? 'minimal';
}

export function setCardMode(nodeId: string, mode: CardMode): void {
    const card: NodeCardData | undefined = nodeCards.get(nodeId);
    if (card) {
        card.mode = mode;
    }
}

// Pin state — tracks which node card IDs are persistently pinned (won't collapse on mouseleave/click-outside)
const pinnedCards: Set<string> = new Set();

export function pinCard(nodeId: string): void {
    pinnedCards.add(nodeId);
}

export function unpinCard(nodeId: string): void {
    pinnedCards.delete(nodeId);
}

export function isCardPinned(nodeId: string): boolean {
    return pinnedCards.has(nodeId);
}
