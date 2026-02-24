/**
 * Setup view subscriptions for VoiceTreeGraphView
 * Manages terminal, navigation, and editor change subscriptions
 *
 * This is an "edge" module - it handles side effects (event listeners, subscriptions)
 * and returns cleanup functions for lifecycle management.
 */
import type {Core} from 'cytoscape';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import type {GraphNavigationService} from './navigation/GraphNavigationService';
import {subscribeToActiveTerminalChange} from '@/shell/edge/UI-edge/state/TerminalStore';
import {getShadowNodeId} from '@/shell/edge/UI-edge/floating-windows/types';
import {TERMINAL_ACTIVE_CLASS} from '@/shell/UI/cytoscape-graph-ui/constants';
import {handleWorktreeDeleteEvent} from './handleWorktreeDelete';
import {subscribeToVaultPaths, getVaultState} from '@/shell/edge/UI-edge/state/VaultPathStore';
import type {VaultPathState} from '@/shell/edge/UI-edge/state/VaultPathStore';
import {triggerFullLayout} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayout';

export interface ViewSubscriptionDeps {
    cy: Core;
    navigationService: GraphNavigationService;
}

export interface ViewSubscriptionCleanups {
    activeTerminalSubscription: () => void;
    navigationListener: () => void;
    worktreeDeleteListener: () => void;
    vaultPathSubscription: () => void;
}

/**
 * Setup all view subscriptions and return cleanup functions.
 * Each subscription is independent and can be cleaned up individually.
 *
 * Note: Terminal tree sidebar rendering is handled by the React TerminalTreeSidebar component,
 * which subscribes to TerminalStore internally. This module only handles cytoscape highlighting
 * for the active terminal.
 */
export function setupViewSubscriptions(deps: ViewSubscriptionDeps): ViewSubscriptionCleanups {
    const {cy, navigationService} = deps;

    // Active terminal subscription - highlights active terminal edges/outline in cytoscape
    // (The sidebar tab highlighting is handled by React TerminalTreeSidebar internally)
    const activeTerminalSubscription: () => void = subscribeToActiveTerminalChange(
        (terminalId: TerminalId | null) => {
            // Clear previous terminal highlighting (cytoscape elements)
            cy.$('.' + TERMINAL_ACTIVE_CLASS).removeClass(TERMINAL_ACTIVE_CLASS);

            // Clear previous terminal highlighting (DOM elements)
            document.querySelectorAll('.cy-floating-window-terminal.' + TERMINAL_ACTIVE_CLASS)
                .forEach((el: Element) => el.classList.remove(TERMINAL_ACTIVE_CLASS));

            // Apply highlighting to new active terminal
            if (terminalId) {
                const shadowNodeId: string = getShadowNodeId(terminalId);
                // Highlight the shadow node (gold outline on cytoscape canvas)
                cy.$id(shadowNodeId).addClass(TERMINAL_ACTIVE_CLASS);
                // Highlight the task node → terminal edge (gold color)
                cy.edges(`[target = "${shadowNodeId}"]`).addClass(TERMINAL_ACTIVE_CLASS);
                // Show the terminal → created nodes edges (dotted blue, hidden by default)
                cy.edges(`[source = "${shadowNodeId}"]`).addClass(TERMINAL_ACTIVE_CLASS);
                // Highlight the terminal DOM element (gold border)
                const terminalElement: Element | null = document.querySelector(`[data-floating-window-id="${terminalId}"]`);
                if (terminalElement) {
                    terminalElement.classList.add(TERMINAL_ACTIVE_CLASS);
                }
            }
        }
    );

    // Navigation event listener - handles SSE activity panel navigation
    const handleNavigateEvent: (event: Event) => void = (event: Event): void => {
        const customEvent: CustomEvent<{nodeId: string}> = event as CustomEvent<{nodeId: string}>;
        navigationService.handleSearchSelect(customEvent.detail.nodeId);
    };
    window.addEventListener('voicetree-navigate', handleNavigateEvent);
    const navigationListener: () => void = (): void => {
        window.removeEventListener('voicetree-navigate', handleNavigateEvent);
    };

    // Worktree delete request listener - handles trash icon clicks in Run dropdown
    document.addEventListener('vt:request-worktree-delete', handleWorktreeDeleteEvent);
    const worktreeDeleteListener: () => void = (): void => {
        document.removeEventListener('vt:request-worktree-delete', handleWorktreeDeleteEvent);
    };

    // Vault path subscription - triggers full R-tree pack + Cola layout when folders are added/removed.
    // When readPaths changes, the graph topology changed substantially (bulk node add/remove),
    // so we reset the layout to run R-tree packing for global positioning followed by Cola refinement.
    let prevReadPathCount: number = getVaultState().readPaths.length;
    const vaultPathSubscription: () => void = subscribeToVaultPaths((state: VaultPathState) => {
        const newCount: number = state.readPaths.length;
        if (newCount !== prevReadPathCount) {
            prevReadPathCount = newCount;
            triggerFullLayout(cy);
        }
    });

    return {
        activeTerminalSubscription,
        navigationListener,
        worktreeDeleteListener,
        vaultPathSubscription,
    };
}

/**
 * Cleanup all view subscriptions at once.
 * Convenience function for disposing all subscriptions.
 */
export function cleanupViewSubscriptions(cleanups: ViewSubscriptionCleanups): void {
    cleanups.activeTerminalSubscription();
    cleanups.navigationListener();
    cleanups.worktreeDeleteListener();
    cleanups.vaultPathSubscription();
}
