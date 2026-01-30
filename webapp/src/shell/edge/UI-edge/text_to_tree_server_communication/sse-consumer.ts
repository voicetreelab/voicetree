import type { SSEEvent } from '@/shell/UI/sse-status-panel/sse-status-panel';

const SSE_EVENT_TYPES: readonly string[] = [
    'phase_started', 'phase_complete',
    'action_applied', 'agent_error',
    'rate_limit_error', 'workflow_complete', 'workflow_failed'
] as const;

/**
 * Creates an SSE connection to the backend's /stream-progress endpoint.
 * Returns a disconnect function for cleanup.
 */
export function createSSEConnection(backendPort: number, onEvent: (event: SSEEvent) => void): () => void {
    const url: string = `http://localhost:${backendPort}/stream-progress`;
    const eventSource: EventSource = new EventSource(url);
    let hasConnectedOnce: boolean = false;

    SSE_EVENT_TYPES.forEach(type => {
        eventSource.addEventListener(type, (e: MessageEvent) => {
            //console.log('[SSE-Consumer] Raw event received:', type, e.data);
            const data: Record<string, unknown> = JSON.parse(e.data) as Record<string, unknown>;
            onEvent({ type, data, timestamp: Date.now() });
        });
    });

    eventSource.onerror = () => {
        // Distinguish between initial loading (never connected) and actual disconnection
        const eventType: string = hasConnectedOnce ? 'connection_error' : 'connection_loading';
        onEvent({
            type: eventType,
            data: { message: hasConnectedOnce ? 'SSE connection lost' : 'Connecting to server' },
            timestamp: Date.now()
        });
    };

    eventSource.onopen = () => {
        hasConnectedOnce = true;
        onEvent({
            type: 'connection_open',
            data: { message: 'Connected to backend', port: backendPort },
            timestamp: Date.now()
        });
    };

    return () => eventSource.close();
}
