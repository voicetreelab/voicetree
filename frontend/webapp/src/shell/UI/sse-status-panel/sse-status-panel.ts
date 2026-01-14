import {createSSEConnection} from "@/shell/edge/UI-edge/text_to_tree_server_communication/sse-consumer";
import type {} from "@/shell/electron"; // Side-effect import for global Window.electronAPI type

export interface SSEEvent {
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
}

interface NodeInfo {
    title: string;
    filename: string;
    is_new: boolean;
}

const STATUS_PANEL_MOUNT_ID: string = 'sse-status-panel-mount';

/**
 * Server Activity Panel - horizontal bar at bottom of app.
 * Displays server events as horizontal cards, newest on right with autoscroll.
 * On hover, panel height expands and cards wrap into multiple rows.
 */
export class SseStatusPanel {
    private container: HTMLElement;
    private eventsContainer: HTMLElement;
    private maxEvents = 2000;
    private disconnectSSE: (() => void) | null = null;

    private constructor(mountPoint: HTMLElement) {
        this.container = document.createElement('div');
        this.container.className = 'server-activity-panel';

        // Expand/collapse arrow button above the panel - minimal chevron style matching transcribe panel
        const expandArrow: HTMLButtonElement = document.createElement('button');
        expandArrow.className = 'server-activity-expand-arrow';
        // SVG matches lucide-react ChevronDown at size 16
        expandArrow.innerHTML = `<svg class="arrow-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
        expandArrow.title = 'Expand/collapse activity panel';
        expandArrow.addEventListener('click', () => {
            const isExpanded: boolean = this.container.classList.toggle('expanded');
            if (isExpanded) {
                this.eventsContainer.scrollLeft = 0;
            } else {
                // Scroll to rightmost (newest) item when collapsing
                requestAnimationFrame(() => {
                    this.eventsContainer.scrollLeft = this.eventsContainer.scrollWidth;
                });
            }
        });
        this.container.appendChild(expandArrow);

        // Horizontal scrollable events container (expands via .expanded class on click)
        this.eventsContainer = document.createElement('div');
        this.eventsContainer.className = 'server-activity-events';
        this.container.appendChild(this.eventsContainer);

        mountPoint.appendChild(this.container);

        // Initialize SSE connection
        this.initSSEConnection();
    }

    /** Initialize SseStatusPanel by finding mount point in DOM, waiting if necessary */
    static init(): void {
        const mountPoint: HTMLElement | null = document.getElementById(STATUS_PANEL_MOUNT_ID);
        if (mountPoint) {
            console.log('[SseStatusPanel] Initializing');
            new SseStatusPanel(mountPoint);
            return;
        }

        // Mount point not ready yet - watch for it
        const observer: MutationObserver = new MutationObserver((_, obs) => {
            const el: HTMLElement | null = document.getElementById(STATUS_PANEL_MOUNT_ID);
            if (el) {
                obs.disconnect();
                console.log('[SseStatusPanel] Initializing (after DOM ready)');
                new SseStatusPanel(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    private initSSEConnection(): void {
        window.electronAPI?.main.getBackendPort().then((port: number | null) => {
            if (port) {
                console.log('[SseStatusPanel] Creating SSE connection on port', port);
                this.disconnectSSE = createSSEConnection(port, event => this.addEvent(event));
            }
        }).catch(() => console.error('[SseStatusPanel] Failed to get backend port'));
    }

    addEvent(event: SSEEvent): void {
        console.log('[SSE] Received event:', event.type, event.data);

        // Handle workflow_complete with individual node cards
        if (event.type === 'workflow_complete') {
            const nodes: NodeInfo[] | undefined = event.data.nodes as NodeInfo[] | undefined;
            if (nodes && nodes.length > 0) {
                for (const node of nodes) {
                    this.addNodeCard(node, event.timestamp);
                }
                return;
            }
        }

        const message: string = this.getEventMessage(event);
        console.log('[SSE] getEventMessage returned:', JSON.stringify(message), 'for event type:', event.type);
        if (!message){
            console.log('[SSE] FILTERED OUT:', event.type);
            return; // to allow ignoring certain sse events
        }

        console.log('[SSE] Creating card for:', event.type);
        const card: HTMLDivElement = document.createElement('div');
        card.className = `server-activity-card event-${event.type}`;
        card.innerHTML = this.formatEventCard(event);

        // Append: newest on right, then autoscroll
        this.eventsContainer.appendChild(card);
        this.trimOldEvents();
        this.scrollToNewest();
    }

    /** Add a clickable node card for workflow_complete events */
    private addNodeCard(node: NodeInfo, timestamp: number): void {
        const card: HTMLDivElement = document.createElement('div');
        const colorClass: string = node.is_new ? 'node-new' : 'node-modified';
        card.className = `server-activity-card ${colorClass}`;

        // Truncate title to 30 chars
        const truncatedTitle: string = node.title.length > 30
            ? node.title.slice(0, 30) + '…'
            : node.title;

        const icon: string = node.is_new ? '+' : '~';
        const time: string = new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        card.innerHTML = `
            <span class="activity-icon">${icon}</span>
            <span class="activity-node-title">${truncatedTitle}</span>
            <span class="activity-time">${time}</span>
        `;

        // Click to navigate
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            this.navigateToNode(node.filename);
        });

        this.eventsContainer.appendChild(card);
        this.trimOldEvents();
        this.scrollToNewest();
    }

    /** Dispatch navigation event for VoiceTreeGraphView to handle */
    private navigateToNode(filename: string): void {
        // filename now includes vault folder from backend, use directly as nodeId
        window.dispatchEvent(new CustomEvent('voicetree-navigate', {
            detail: { nodeId: filename }
        }));
    }

    private formatEventCard(event: SSEEvent): string {
        const time: string = new Date(event.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const icon: string = this.getEventIcon(event.type);
        const message: string = this.getEventMessage(event);
        const nodeTitles: string = this.getNodeTitlesHtml(event);

        return `
            <span class="activity-icon">${icon}</span>
            <span class="activity-message">${message}</span>${nodeTitles}
            <span class="activity-time">${time}</span>
        `;
    }

    private getNodeTitlesHtml(event: SSEEvent): string {
        if (event.type !== 'workflow_complete') return '';
        const titles: string[] | undefined = event.data.node_titles as string[] | undefined;
        if (!titles || titles.length === 0) return '';
        return `<span class="activity-node-titles">${titles.join(', ')}</span>`;
    }

    private getEventIcon(type: string): string {
        const icons: Record<string, string> = {
            phase_started: '▶',
            phase_complete: '✓',
            action_applied: '•',
            agent_error: '✗',
            rate_limit_error: '⏱',
            workflow_complete: '✓✓',
            workflow_failed: '✗✗',
            connection_error: '⚡',
            connection_loading: '◌',
            connection_open: '○'
        };
        return icons[type] || '○';
    }

    private getEventMessage(event: SSEEvent): string {
        switch (event.type) {
            case 'phase_started': {
                const phase: string = event.data.phase as string;
                if (phase === 'placement' && event.data.text_chunk) {
                    const text: string = event.data.text_chunk as string;
                    const first30: string = text.slice(0, 30);
                    const rest: string = text.length > 30 ? `<span class="activity-text-rest">${text.slice(30)}</span>` : '';
                    return `${phase}: ${first30}${rest} <span class="activity-processing-spinner">◌</span>`;
                }
                return `${phase}`;
            }
            case 'phase_complete':
                return ""; // ignore phase_complete for now.
            case 'rate_limit_error':
                return `Rate limit`;
            case 'workflow_complete':
                return `Done (${event.data.total_nodes} nodes)`;
            case 'connection_open':
                return `Speech-to-tree server connected`;
            case 'connection_loading':
                return 'Loading...';
            case 'connection_error':
                return 'Disconnected';
            case 'workflow_failed': {
                const error: string = (event.data.error as string) || 'Unknown error';
                const first50: string = error.slice(0, 35);
                const rest: string = error.length > 35 ? `<span class="activity-text-rest">${error.slice(35)}</span>` : '';
                return `${first50}${rest}`;
            }
            default:
                return event.type.replace(/_/g, ' ');
        }
    }

    private trimOldEvents(): void {
        while (this.eventsContainer.children.length > this.maxEvents) {
            // Remove oldest (first child) since newest is on right
            this.eventsContainer.removeChild(this.eventsContainer.firstChild!);
        }
    }

    private scrollToNewest(): void {
        // Defer scroll until after layout calculation is complete
        requestAnimationFrame(() => {
            this.eventsContainer.scrollLeft = this.eventsContainer.scrollWidth;
        });
    }

    dispose(): void {
        if (this.disconnectSSE) {
            console.log('[SseStatusPanel] Disconnecting SSE');
            this.disconnectSSE();
        }
        this.container.remove();
    }
}
