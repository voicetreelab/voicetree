import {
    listeners,
    terminalRecords,
    type RegistryListener,
    type TerminalRecord,
} from '../terminal-registry-state'

export function getTerminalRecords(): TerminalRecord[] {
    return Array.from(terminalRecords.values())
}

export function subscribeToRegistry(listener: RegistryListener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function notifyRegistrySubscribers(): void {
    if (listeners.size === 0) return
    const snapshot: TerminalRecord[] = getTerminalRecords()
    for (const listener of listeners) listener(snapshot)
}
