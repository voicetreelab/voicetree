import type { SSEEvent } from './status-panel';

const SSE_EVENT_TYPES = [
    'phase_started', 'phase_complete',
    'action_applied', 'agent_error',
    'rate_limit_error', 'workflow_complete', 'workflow_failed'
] as const;

/**
 * Creates an SSE connection to the backend's /stream-progress endpoint.
 * Returns a disconnect function for cleanup.
 */
export function createSSEConnection(backendPort: number, onEvent: (event: SSEEvent) => void): () => void {
    const url = `http://localhost:${backendPort}/stream-progress`;
    const eventSource = new EventSource(url);

    SSE_EVENT_TYPES.forEach(type => {
        eventSource.addEventListener(type, (e: MessageEvent) => {
            const data = JSON.parse(e.data) as Record<string, unknown>;
            onEvent({ type, data, timestamp: Date.now() });
        });
    });

    eventSource.onerror = () => {
        onEvent({
            type: 'connection_error',
            data: { message: 'SSE connection lost' },
            timestamp: Date.now()
        });
    };

    eventSource.onopen = () => {
        onEvent({
            type: 'connection_open',
            data: { message: 'Connected to backend' },
            timestamp: Date.now()
        });
    };

    return () => eventSource.close();
}
