/**
 * Drag Reorder Behavior - Reusable drag-and-drop reordering for list items
 *
 * Provides visual feedback with a ghost element and calls back with
 * the from/to indices when items are reordered.
 */

// =============================================================================
// Types
// =============================================================================

export interface DragReorderConfig {
    /** CSS class for the ghost element shown during drag */
    ghostClass: string;
    /** CSS class added to the element being dragged */
    draggingClass: string;
    /** Callback when an item is reordered */
    onReorder: (fromIndex: number, toIndex: number) => void;
    /** Selector to find draggable items within the container (default: direct children) */
    itemSelector?: string;
}

interface DragState {
    ghostElement: HTMLElement | null;
    draggingFromIndex: number | null;
    ghostTargetIndex: number | null;
}

// =============================================================================
// Pure Functions
// =============================================================================

/**
 * Calculate which side of an element the mouse is on
 */
export function calculateDropPosition(
    mouseX: number,
    elementRect: DOMRect
): 'before' | 'after' {
    const midpoint: number = elementRect.left + elementRect.width / 2;
    return mouseX > midpoint ? 'after' : 'before';
}

/**
 * Calculate the adjusted target index accounting for the drag source position
 */
export function calculateAdjustedTargetIndex(
    fromIndex: number,
    targetIndex: number
): number {
    return fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
}

// =============================================================================
// Ghost Element
// =============================================================================

function createGhostElement(ghostClass: string): HTMLElement {
    const ghost: HTMLElement = document.createElement('div');
    ghost.className = ghostClass;
    return ghost;
}

function removeGhostElement(state: DragState): void {
    if (state.ghostElement && state.ghostElement.parentNode) {
        state.ghostElement.parentNode.removeChild(state.ghostElement);
    }
    state.ghostElement = null;
    state.ghostTargetIndex = null;
}

// =============================================================================
// Behavior Attachment
// =============================================================================

/**
 * Attach drag reorder behavior to a container element.
 * Items within the container can be reordered by dragging.
 *
 * @param container - The container element holding draggable items
 * @param config - Configuration for the drag behavior
 * @returns Cleanup function to remove all event listeners
 */
export function attachDragReorderBehavior(
    container: HTMLElement,
    config: DragReorderConfig
): () => void {
    const state: DragState = {
        ghostElement: null,
        draggingFromIndex: null,
        ghostTargetIndex: null,
    };

    const { ghostClass, draggingClass, onReorder, itemSelector } = config;

    // Get all draggable items
    const getItems = (): HTMLElement[] => {
        if (itemSelector) {
            return Array.from(container.querySelectorAll(itemSelector)) as HTMLElement[];
        }
        return Array.from(container.children) as HTMLElement[];
    };

    // Container-level dragover handler for dropping at the end
    const onContainerDragOver = (e: DragEvent): void => {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        if (state.ghostElement && state.draggingFromIndex !== null) {
            const items: HTMLElement[] = getItems();
            if (items.length > 0) {
                const lastItem: HTMLElement = items[items.length - 1];
                const lastItemRect: DOMRect = lastItem.getBoundingClientRect();
                if (e.clientX > lastItemRect.right) {
                    container.appendChild(state.ghostElement);
                    state.ghostTargetIndex = items.length;
                }
            }
        }
    };

    // Container-level drop handler
    const onContainerDrop = (e: DragEvent): void => {
        e.preventDefault();
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1');
        const targetIndex: number | null = state.ghostTargetIndex;
        removeGhostElement(state);
        state.draggingFromIndex = null;

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
            onReorder(fromIndex, adjustedTarget);
        }
    };

    container.addEventListener('dragover', onContainerDragOver);
    container.addEventListener('drop', onContainerDrop);

    // Store cleanup functions for item listeners
    const itemCleanups: (() => void)[] = [];

    /**
     * Attach drag handlers to a single item
     */
    const attachItemHandlers = (
        item: HTMLElement,
        wrapper: HTMLElement,
        index: number
    ): () => void => {
        const onDragStart = (e: DragEvent): void => {
            e.stopPropagation();
            item.classList.add(draggingClass);
            e.dataTransfer?.setData('text/plain', String(index));
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
            }
            state.draggingFromIndex = index;
            state.ghostElement = createGhostElement(ghostClass);
        };

        const onDragEnd = (e: DragEvent): void => {
            e.stopPropagation();
            item.classList.remove(draggingClass);
            removeGhostElement(state);
            state.draggingFromIndex = null;
        };

        const onDragOver = (e: DragEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            if (state.draggingFromIndex === index) {
                return;
            }
            if (state.ghostElement) {
                const rect: DOMRect = wrapper.getBoundingClientRect();
                const position: 'before' | 'after' = calculateDropPosition(e.clientX, rect);

                if (position === 'after') {
                    const nextSibling: Element | null = wrapper.nextElementSibling;
                    if (nextSibling && !nextSibling.classList.contains(ghostClass)) {
                        container.insertBefore(state.ghostElement, nextSibling);
                    } else if (!nextSibling) {
                        container.appendChild(state.ghostElement);
                    }
                    state.ghostTargetIndex = index + 1;
                } else {
                    container.insertBefore(state.ghostElement, wrapper);
                    state.ghostTargetIndex = index;
                }
            }
        };

        const onDragLeave = (e: DragEvent): void => {
            e.stopPropagation();
        };

        const onDrop = (e: DragEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1');
            const targetIndex: number | null = state.ghostTargetIndex;
            removeGhostElement(state);
            state.draggingFromIndex = null;

            if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
                const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
                onReorder(fromIndex, adjustedTarget);
            }
        };

        item.addEventListener('dragstart', onDragStart);
        item.addEventListener('dragend', onDragEnd);
        item.addEventListener('dragover', onDragOver);
        item.addEventListener('dragleave', onDragLeave);
        item.addEventListener('drop', onDrop);

        return (): void => {
            item.removeEventListener('dragstart', onDragStart);
            item.removeEventListener('dragend', onDragEnd);
            item.removeEventListener('dragover', onDragOver);
            item.removeEventListener('dragleave', onDragLeave);
            item.removeEventListener('drop', onDrop);
        };
    };

    // Return cleanup function
    return (): void => {
        container.removeEventListener('dragover', onContainerDragOver);
        container.removeEventListener('drop', onContainerDrop);
        removeGhostElement(state);
        for (const cleanup of itemCleanups) {
            cleanup();
        }
    };
}

/**
 * Attach drag handlers to a single draggable item.
 * Call this when creating new items that should be draggable.
 *
 * @param item - The draggable element (e.g., a button)
 * @param wrapper - The wrapper element that determines drop position
 * @param index - The current index of this item
 * @param container - The container element
 * @param config - The drag configuration
 * @param state - Shared drag state (create with createDragState())
 * @returns Cleanup function to remove event listeners
 */
export function attachItemDragHandlers(
    item: HTMLElement,
    wrapper: HTMLElement,
    index: number,
    container: HTMLElement,
    config: Pick<DragReorderConfig, 'ghostClass' | 'draggingClass' | 'onReorder'>,
    state: DragState
): () => void {
    const { ghostClass, draggingClass, onReorder } = config;

    const onDragStart = (e: DragEvent): void => {
        e.stopPropagation();
        item.classList.add(draggingClass);
        e.dataTransfer?.setData('text/plain', String(index));
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
        }
        state.draggingFromIndex = index;
        state.ghostElement = createGhostElement(ghostClass);
    };

    const onDragEnd = (e: DragEvent): void => {
        e.stopPropagation();
        item.classList.remove(draggingClass);
        removeGhostElement(state);
        state.draggingFromIndex = null;
    };

    const onDragOver = (e: DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        if (state.draggingFromIndex === index) {
            return;
        }
        if (state.ghostElement) {
            const rect: DOMRect = wrapper.getBoundingClientRect();
            const position: 'before' | 'after' = calculateDropPosition(e.clientX, rect);

            if (position === 'after') {
                const nextSibling: Element | null = wrapper.nextElementSibling;
                if (nextSibling && !nextSibling.classList.contains(ghostClass)) {
                    container.insertBefore(state.ghostElement, nextSibling);
                } else if (!nextSibling) {
                    container.appendChild(state.ghostElement);
                }
                state.ghostTargetIndex = index + 1;
            } else {
                container.insertBefore(state.ghostElement, wrapper);
                state.ghostTargetIndex = index;
            }
        }
    };

    const onDragLeave = (e: DragEvent): void => {
        e.stopPropagation();
    };

    const onDrop = (e: DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1');
        const targetIndex: number | null = state.ghostTargetIndex;
        removeGhostElement(state);
        state.draggingFromIndex = null;

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = calculateAdjustedTargetIndex(fromIndex, targetIndex);
            onReorder(fromIndex, adjustedTarget);
        }
    };

    item.addEventListener('dragstart', onDragStart);
    item.addEventListener('dragend', onDragEnd);
    item.addEventListener('dragover', onDragOver);
    item.addEventListener('dragleave', onDragLeave);
    item.addEventListener('drop', onDrop);

    return (): void => {
        item.removeEventListener('dragstart', onDragStart);
        item.removeEventListener('dragend', onDragEnd);
        item.removeEventListener('dragover', onDragOver);
        item.removeEventListener('dragleave', onDragLeave);
        item.removeEventListener('drop', onDrop);
    };
}

/**
 * Create shared drag state for use with attachItemDragHandlers
 */
export function createDragState(): DragState {
    return {
        ghostElement: null,
        draggingFromIndex: null,
        ghostTargetIndex: null,
    };
}

/**
 * Clean up drag state (remove ghost element)
 */
export function cleanupDragState(state: DragState): void {
    removeGhostElement(state);
    state.draggingFromIndex = null;
}
