// Tracks HTML card elements for card-backed nodes
// Parallel to EditorStore — but for node cards (Phase 2)

export type NodeCardData = {
    readonly windowElement: HTMLElement;
    readonly contentContainer: HTMLElement;
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

// Pin state — tracks which node card IDs are persistently pinned (won't collapse on click-outside)
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
