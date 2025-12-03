import {createSSEConnection} from "@/shell/edge/UI-edge/text_to_tree_server_communication/sse-consumer";

export interface SSEEvent {
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
}

const STATUS_PANEL_MOUNT_ID: string = 'sse-status-panel-mount';

/**
 * Server Activity Panel - horizontal bar at bottom of app.
 * Displays server events as horizontal cards, FIFO (newest on left).
 */
export class SseStatusPanel {
    private container: HTMLElement;
    private eventsContainer: HTMLElement;
    private maxEvents = 2000;
    private disconnectSSE: (() => void) | null = null;

    private constructor(mountPoint: HTMLElement) {
        this.container = document.createElement('div');
        this.container.className = 'server-activity-panel';

        // Horizontal scrollable events container
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

        if (!this.getEventMessage(event)){
            return; // to allow ignoring certain sse events
        }

        const card: HTMLDivElement = document.createElement('div');
        card.className = `server-activity-card event-${event.type}`;
        card.innerHTML = this.formatEventCard(event);

        // Prepend: newest on left (FIFO)
        this.eventsContainer.prepend(card);
        this.trimOldEvents();
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
        const titles = event.data.node_titles as string[] | undefined;
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
            connection_open: '○'
        };
        return icons[type] || '○';
    }

    private getEventMessage(event: SSEEvent): string {
        switch (event.type) {
            case 'phase_started': {
                const phase = event.data.phase as string;
                if (phase === 'placement' && event.data.text_chunk) {
                    const text = event.data.text_chunk as string;
                    const first30 = text.slice(0, 30);
                    const rest = text.length > 30 ? `<span class="activity-text-rest">${text.slice(30)}</span>` : '';
                    return `${phase}: ${first30}${rest}`;
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
                return `Connected :${event.data.port}`;
            case 'connection_error':
                return 'Disconnected';
            case 'workflow_failed': {
                const error = (event.data.error as string) || 'Unknown error';
                const first50 = error.slice(0, 35);
                const rest = error.length > 35 ? `<span class="activity-text-rest">${error.slice(35)}</span>` : '';
                return `${first50}${rest}`;
            }
            default:
                return event.type.replace(/_/g, ' ');
        }
    }

    private trimOldEvents(): void {
        while (this.eventsContainer.children.length > this.maxEvents) {
            this.eventsContainer.removeChild(this.eventsContainer.lastChild!);
        }
    }

    dispose(): void {
        if (this.disconnectSSE) {
            console.log('[SseStatusPanel] Disconnecting SSE');
            this.disconnectSSE();
        }
        this.container.remove();
    }
}
