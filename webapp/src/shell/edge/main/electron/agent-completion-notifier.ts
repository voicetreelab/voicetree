import { Notification, BrowserWindow } from 'electron';
import { loadSettings } from '@vt/app-config/settings';
import type { TerminalRecord } from '@vt/agent-runtime';
import type { TerminalLifecycle } from '@vt/agent-runtime/lifecycle';

const NOTIFY_STATES: ReadonlySet<TerminalLifecycle> = new Set(['completed', 'errored', 'awaiting_input']);
const BATCH_WINDOW_MS: number = 5_000;

export type CompletionEvent = {
    readonly terminalId: string;
    readonly agentName: string;
    readonly lifecycle: 'completed' | 'errored' | 'awaiting_input';
};

export function detectCompletions(
    prev: readonly TerminalRecord[],
    next: readonly TerminalRecord[],
): readonly CompletionEvent[] {
    const prevByTerminalId: Map<string, TerminalRecord> = new Map(
        prev.map(r => [r.terminalId, r]),
    );

    const events: CompletionEvent[] = [];
    for (const record of next) {
        const lifecycle: TerminalLifecycle = record.terminalData.lifecycle;
        if (!NOTIFY_STATES.has(lifecycle)) continue;

        const prevRecord: TerminalRecord | undefined = prevByTerminalId.get(record.terminalId);
        if (prevRecord && NOTIFY_STATES.has(prevRecord.terminalData.lifecycle)) continue;

        events.push({
            terminalId: record.terminalId,
            agentName: record.terminalData.agentName,
            lifecycle: lifecycle as 'completed' | 'errored',
        });
    }
    return events;
}

function isAppFocused(): boolean {
    return BrowserWindow.getAllWindows().some(w => w.isFocused());
}

function showCompletionNotification(events: readonly CompletionEvent[]): void {
    if (!Notification.isSupported()) return;

    const awaiting: readonly CompletionEvent[] = events.filter(e => e.lifecycle === 'awaiting_input');
    const completed: readonly CompletionEvent[] = events.filter(e => e.lifecycle === 'completed');
    const errored: readonly CompletionEvent[] = events.filter(e => e.lifecycle === 'errored');

    const parts: string[] = [];
    if (awaiting.length === 1) {
        parts.push(`${awaiting[0].agentName} is waiting for input`);
    } else if (awaiting.length > 1) {
        parts.push(`${awaiting.length} agents waiting for input`);
    }
    if (completed.length === 1) {
        parts.push(`${completed[0].agentName} completed`);
    } else if (completed.length > 1) {
        parts.push(`${completed.length} agents completed`);
    }
    if (errored.length === 1) {
        parts.push(`${errored[0].agentName} errored`);
    } else if (errored.length > 1) {
        parts.push(`${errored.length} agents errored`);
    }

    const notification: Notification = new Notification({
        title: 'Voicetree',
        body: parts.join(', '),
        silent: true,
    });

    notification.on('click', () => {
        const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            const mainWindow: BrowserWindow = windows[0];
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    notification.show();
}

export function createAgentCompletionNotifier(): (records: readonly TerminalRecord[]) => void {
    let previousRecords: readonly TerminalRecord[] = [];
    let pendingEvents: CompletionEvent[] = [];
    let batchTimeout: ReturnType<typeof setTimeout> | null = null;

    return (records: readonly TerminalRecord[]): void => {
        if (process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1') return;

        const events: readonly CompletionEvent[] = detectCompletions(previousRecords, records);
        previousRecords = records;

        if (events.length === 0) return;

        pendingEvents.push(...events);

        if (batchTimeout !== null) return;

        batchTimeout = setTimeout(() => {
            batchTimeout = null;
            const batch: readonly CompletionEvent[] = pendingEvents;
            pendingEvents = [];

            if (isAppFocused()) return;

            void loadSettings()
                .then(settings => {
                    if (settings.notifyOnAgentCompletion !== false) {
                        showCompletionNotification(batch);
                    }
                })
                .catch(() => {});
        }, BATCH_WINDOW_MS);
    };
}
