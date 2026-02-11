/**
 * Dispose/cleanup logic for VoiceTreeGraphView
 * Pure function that tears down all resources given as dependencies
 */
import type {Core} from 'cytoscape';
import type {HotkeyManager} from './HotkeyManager';
import type {SearchService} from './SearchService';
import type {EventEmitter} from './EventEmitter';
import type {NavigationGestureService} from '@/shell/edge/UI-edge/graph/navigation/NavigationGestureService';
import type {HorizontalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/HorizontalMenuService';
import type {VerticalMenuService} from '@/shell/UI/cytoscape-graph-ui/services/VerticalMenuService';
import type {BreathingAnimationService} from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService';
import type {SpeedDialSideGraphFloatingMenuView} from './SpeedDialSideGraphFloatingMenuView';
import type {ViewSubscriptionCleanups} from '@/shell/edge/UI-edge/graph/setupViewSubscriptions';
import {cleanupViewSubscriptions} from '@/shell/edge/UI-edge/graph/setupViewSubscriptions';
import {disposeEditorManager} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {disposeTerminalTreeSidebar} from './treeStyleTerminalTabs/TerminalTreeSidebar';
import {disposeGraphViewOverlays} from '@/shell/edge/UI-edge/state/GraphViewUIStore';

export interface GraphViewDisposeDependencies {
    cy: Core;
    handleResize: () => void;
    cleanupGraphSubscription: (() => void) | null;
    viewSubscriptionCleanups: ViewSubscriptionCleanups | null;
    hotkeyManager: HotkeyManager;
    gestureService: NavigationGestureService;
    searchService: SearchService;
    horizontalMenuService?: HorizontalMenuService;
    verticalMenuService?: VerticalMenuService;
    speedDialMenu: SpeedDialSideGraphFloatingMenuView | null;
    animationService?: BreathingAnimationService;
    navigator: { destroy: () => void } | null;
    nodeSelectedEmitter: EventEmitter<string>;
    nodeDoubleClickEmitter: EventEmitter<string>;
    edgeSelectedEmitter: EventEmitter<{ source: string; target: string }>;
    layoutCompleteEmitter: EventEmitter<void>;
}

/**
 * Dispose all graph view resources in the correct order.
 * Handles null-safety for optional services.
 */
export function disposeGraphView(deps: GraphViewDisposeDependencies): void {
    // Remove window event listeners
    window.removeEventListener('resize', deps.handleResize);

    // Cleanup graph subscription
    if (deps.cleanupGraphSubscription) {
        deps.cleanupGraphSubscription();
    }

    // Cleanup view subscriptions (terminals, navigation, pinned editors)
    if (deps.viewSubscriptionCleanups) {
        cleanupViewSubscriptions(deps.viewSubscriptionCleanups);
    }

    // Dispose managers
    deps.hotkeyManager.dispose();
    deps.gestureService.dispose();
    disposeEditorManager(deps.cy);
    deps.searchService.dispose();
    disposeTerminalTreeSidebar();
    disposeGraphViewOverlays();

    // Dispose menu services
    if (deps.horizontalMenuService) {
        deps.horizontalMenuService.destroy();
    }
    if (deps.verticalMenuService) {
        deps.verticalMenuService.destroy();
    }

    // Dispose speed dial menu
    if (deps.speedDialMenu) {
        deps.speedDialMenu.dispose();
    }

    // Destroy services
    if (deps.animationService) {
        deps.animationService.destroy();
    }

    // Destroy navigator minimap
    if (deps.navigator) {
        deps.navigator.destroy();
    }

    // Destroy Cytoscape
    deps.cy.destroy();

    // Clear event emitters
    deps.nodeSelectedEmitter.clear();
    deps.nodeDoubleClickEmitter.clear();
    deps.edgeSelectedEmitter.clear();
    deps.layoutCompleteEmitter.clear();
}
