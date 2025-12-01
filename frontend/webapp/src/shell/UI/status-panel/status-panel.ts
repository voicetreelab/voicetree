import { createSSEConnection } from './sse-consumer';
import type {} from '@/shell/electron';

export interface SSEEvent {
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
}

const STATUS_PANEL_MOUNT_ID: string = 'status-panel-mount';

/**
 * Server Activity Panel - horizontal bar at bottom of app.
 * Displays server events as horizontal cards, FIFO (newest on left).
 */
export class StatusPanel {
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

    /** Initialize StatusPanel by finding mount point in DOM, waiting if necessary */
    static init(): void {
        const mountPoint: HTMLElement | null = document.getElementById(STATUS_PANEL_MOUNT_ID);
        if (mountPoint) {
            console.log('[StatusPanel] Initializing');
            new StatusPanel(mountPoint);
            return;
        }

        // Mount point not ready yet - watch for it
        const observer: MutationObserver = new MutationObserver((_, obs) => {
            const el: HTMLElement | null = document.getElementById(STATUS_PANEL_MOUNT_ID);
            if (el) {
                obs.disconnect();
                console.log('[StatusPanel] Initializing (after DOM ready)');
                new StatusPanel(el);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    private initSSEConnection(): void {
        window.electronAPI?.main.getBackendPort().then((port: number | null) => {
            if (port) {
                console.log('[StatusPanel] Creating SSE connection on port', port);
                this.disconnectSSE = createSSEConnection(port, event => this.addEvent(event));
            }
        }).catch(() => console.error('[StatusPanel] Failed to get backend port'));
    }

    addEvent(event: SSEEvent): void {
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

        return `
            <span class="activity-icon">${icon}</span>
            <span class="activity-message">${message}</span>
            <span class="activity-time">${time}</span>
        `;
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
            case 'phase_started':
                return `${event.data.phase}`;
            case 'phase_complete':
                return `${event.data.phase} ✓`;
            case 'rate_limit_error':
                return `Rate limit`;
            case 'workflow_complete':
                return `Done (${event.data.total_nodes} nodes)`;
            case 'connection_open':
                return `Connected :${event.data.port}`;
            case 'connection_error':
                return 'Disconnected';
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
            console.log('[StatusPanel] Disconnecting SSE');
            this.disconnectSSE();
        }
        this.container.remove();
    }
}
