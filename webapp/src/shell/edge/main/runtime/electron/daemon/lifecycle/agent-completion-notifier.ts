import {BrowserWindow, Notification} from 'electron';
import {loadSettings} from '@vt/app-config/settings';
import type {TerminalLifecycle, TerminalRecord} from '@vt/vt-daemon-client';

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
            lifecycle: lifecycle as CompletionEvent['lifecycle'],
        });
    }
    return events;
}

function isAppFocused(): boolean {
    return BrowserWindow.getAllWindows().some(w => w.isFocused());
}

function focusFirstWindow(): void {
    const windows: BrowserWindow[] = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const mainWindow: BrowserWindow = windows[0];
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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

    notification.on('click', focusFirstWindow);
    notification.show();
}

type NotifierState = {
    previousRecords: readonly TerminalRecord[];
    pendingEvents: CompletionEvent[];
    batchTimeout: ReturnType<typeof setTimeout> | null;
};

function shouldSkipNotifications(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.HEADLESS_TEST === '1';
}

function showBatchWhenEnabled(batch: readonly CompletionEvent[]): void {
    if (isAppFocused()) return;

    void loadSettings()
        .then(settings => {
            if (settings.notifyOnAgentCompletion !== false) {
                showCompletionNotification(batch);
            }
        })
        .catch(() => {});
}

function scheduleNotificationBatch(state: NotifierState): void {
    if (state.batchTimeout !== null) return;

    state.batchTimeout = setTimeout(() => {
        state.batchTimeout = null;
        const batch: readonly CompletionEvent[] = state.pendingEvents;
        state.pendingEvents = [];
        showBatchWhenEnabled(batch);
    }, BATCH_WINDOW_MS);
}

function updateNotifierState(state: NotifierState, records: readonly TerminalRecord[]): void {
    if (shouldSkipNotifications()) return;

    const events: readonly CompletionEvent[] = detectCompletions(state.previousRecords, records);
    state.previousRecords = records;
    if (events.length === 0) return;

    state.pendingEvents.push(...events);
    scheduleNotificationBatch(state);
}

export function createAgentCompletionNotifier(): (records: readonly TerminalRecord[]) => void {
    const state: NotifierState = {
        previousRecords: [],
        pendingEvents: [],
        batchTimeout: null,
    };

    return (records: readonly TerminalRecord[]): void => updateNotifierState(state, records);
}
