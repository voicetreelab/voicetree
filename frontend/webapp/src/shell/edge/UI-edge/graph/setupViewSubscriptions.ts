/**
 * Setup view subscriptions for VoiceTreeGraphView
 * Manages terminal, navigation, and editor change subscriptions
 *
 * This is an "edge" module - it handles side effects (event listeners, subscriptions)
 * and returns cleanup functions for lifecycle management.
 */
import type {Core} from 'cytoscape';
import type {TerminalData} from '@/shell/electron';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import type {GraphNavigationService} from './navigation/GraphNavigationService';
import {subscribeToTerminalChanges} from '@/shell/edge/UI-edge/state/TerminalStore';
import {renderAgentTabs, setActiveTerminal, clearActivityForTerminal} from '@/shell/UI/views/AgentTabsBar';
import {getTerminalId} from '@/shell/edge/UI-edge/floating-windows/types';
import {renderRecentNodeTabsV2} from '@/shell/UI/views/RecentNodeTabsBar';
import {getRecentNodeHistory} from '@/shell/edge/UI-edge/state/RecentNodeHistoryStore';

export interface ViewSubscriptionDeps {
    cy: Core;
    navigationService: GraphNavigationService;
}

export interface ViewSubscriptionCleanups {
    terminalSubscription: () => void;
    activeTerminalSubscription: () => void;
    navigationListener: () => void;
    pinnedEditorsListener: () => void;
}

/**
 * Setup all view subscriptions and return cleanup functions.
 * Each subscription is independent and can be cleaned up individually.
 */
export function setupViewSubscriptions(deps: ViewSubscriptionDeps): ViewSubscriptionCleanups {
    const {cy, navigationService} = deps;

    // Terminal changes subscription - updates agent tabs bar
    const terminalSubscription: () => void = subscribeToTerminalChanges((terminals: TerminalData[]) => {
        renderAgentTabs(
            terminals,
            (terminal: TerminalData) => {
                // Clear activity dots when user explicitly clicks a tab (not when cycling)
                clearActivityForTerminal(getTerminalId(terminal));
                navigationService.fitToTerminal(terminal);
            }
        );
    });

    // Active terminal subscription - highlights active tab
    const activeTerminalSubscription: () => void = navigationService.onActiveTerminalChange(
        (terminalId: TerminalId | null) => {
            setActiveTerminal(terminalId);
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

    // Pinned editors change listener - re-renders tabs bar
    const handlePinnedEditorsChange: () => void = (): void => {
        renderRecentNodeTabsV2(
            getRecentNodeHistory(),
            (nodeId: string) => navigationService.handleSearchSelect(nodeId),
            (nodeId: string) => cy.getElementById(nodeId).data('label') as string | undefined
        );
    };
    document.addEventListener('pinned-editors-changed', handlePinnedEditorsChange);
    const pinnedEditorsListener: () => void = (): void => {
        document.removeEventListener('pinned-editors-changed', handlePinnedEditorsChange);
    };

    return {
        terminalSubscription,
        activeTerminalSubscription,
        navigationListener,
        pinnedEditorsListener
    };
}

/**
 * Cleanup all view subscriptions at once.
 * Convenience function for disposing all subscriptions.
 */
export function cleanupViewSubscriptions(cleanups: ViewSubscriptionCleanups): void {
    cleanups.terminalSubscription();
    cleanups.activeTerminalSubscription();
    cleanups.navigationListener();
    cleanups.pinnedEditorsListener();
}
