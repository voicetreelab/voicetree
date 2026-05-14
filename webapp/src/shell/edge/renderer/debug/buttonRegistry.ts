// Pure snapshot store for the agent-debugger button registry.
// Components call registerDebugButton (opt-in; no-op in prod builds).
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

// Opt-in React component API — no-op in prod so prod bundles have no overhead.
// Usage: const cleanup = registerDebugButton({ nodeId, label, selector })
//        return cleanup  // inside useEffect
export const registerDebugButton: (entry: ButtonEntry) => () => void = (entry) => {
  if (import.meta.env.PROD) return () => {}
  _register(entry)
  return () => _unregister(entry.nodeId, entry.label)
}
