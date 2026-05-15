import type {TerminalRecord} from './session.ts'

export type Command =
    | { type: 'SetTerminalRecord'; terminalId: string; record: TerminalRecord }
    | { type: 'NotifyRegistrySubscribers' }
    | { type: 'SetIdleSince'; terminalId: string; time: number }
    | { type: 'DeleteIdleSince'; terminalId: string }
    | { type: 'ScheduleIdleHooks'; terminalId: string; record: TerminalRecord; delayMs: number }
    | { type: 'CancelPendingNotification'; terminalId: string }
