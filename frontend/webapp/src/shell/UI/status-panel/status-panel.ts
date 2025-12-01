import { createSSEConnection } from './sse-consumer';

export interface SSEEvent {
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
}

const STATUS_PANEL_MOUNT_ID = 'status-panel-mount';

export class StatusPanel {
    private container: HTMLElement;
    private eventList: HTMLElement;
    private maxEvents = 50;
    private disconnectSSE: (() => void) | null = null;

    private constructor(mountPoint: HTMLElement) {
        this.container = document.createElement('div');
        this.container.className = 'status-panel';

        // Header
        const header: HTMLDivElement = document.createElement('div');
        header.className = 'status-panel-header';
        header.textContent = 'Server Activity';
        this.container.appendChild(header);

        // Event list (scrollable)
        this.eventList = document.createElement('ul');
        this.eventList.className = 'status-panel-events';
        this.container.appendChild(this.eventList);

        mountPoint.appendChild(this.container);

        // Initialize SSE connection
        this.initSSEConnection();
    }

    /** Initialize StatusPanel by finding mount point in DOM, waiting if necessary */
    static init(): void {
        const mountPoint = document.getElementById(STATUS_PANEL_MOUNT_ID);
        if (mountPoint) {
            console.log('[StatusPanel] Initializing');
            new StatusPanel(mountPoint);
            return;
        }

        // Mount point not ready yet - watch for it
        const observer = new MutationObserver((_, obs) => {
            const el = document.getElementById(STATUS_PANEL_MOUNT_ID);
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
        const li: HTMLLIElement = document.createElement('li');
        li.className = `event-item event-${event.type}`;
        li.innerHTML = this.formatEvent(event);
        this.eventList.prepend(li);  // newest at top
        this.trimOldEvents();
    }

    private formatEvent(event: SSEEvent): string {
        const time: string = new Date(event.timestamp).toLocaleTimeString();
        const icon: string = this.getEventIcon(event.type);
        const message: string = this.getEventMessage(event);
        return `<span class="event-time">${time}</span> ${icon} <span class="event-message">${message}</span>`;
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
        // Format based on event type
        switch (event.type) {
            case 'phase_started':
                return `Phase: ${event.data.phase} started`;
            case 'phase_complete':
                return `Phase: ${event.data.phase} complete`;
            case 'rate_limit_error':
                return `Rate limited (retry in ${event.data.retry_after_ms}ms)`;
            case 'workflow_complete':
                return `Workflow complete (${event.data.total_nodes} nodes)`;
            case 'connection_open':
                return 'Connected to server';
            default:
                return event.type.replace(/_/g, ' ');
        }
    }

    private trimOldEvents(): void {
        while (this.eventList.children.length > this.maxEvents) {
            this.eventList.removeChild(this.eventList.lastChild!);
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
