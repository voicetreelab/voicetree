// Pure snapshot store for the agent-debugger button registry.
// Agents read via window.__vtDebug__.buttons() which always reflects the live store.

export interface ButtonEntry {
  readonly nodeId: string
  readonly label: string
  readonly selector: string
}

const _store: Map<string, ButtonEntry> = new Map<string, ButtonEntry>()
const _key: (nodeId: string, label: string) => string = (nodeId, label) => `${nodeId}::${label}`

// Pure read — returns current snapshot of all registered buttons
export const snapshot: () => ButtonEntry[] = () => Array.from(_store.values())

// Internal always-active write (used by window.__vtDebug__ test/agent API)
export const _register: (entry: ButtonEntry) => void = (entry) => {
  _store.set(_key(entry.nodeId, entry.label), entry)
}
export const _unregister: (nodeId: string, label: string) => void = (nodeId, label) => {
  _store.delete(_key(nodeId, label))
}
