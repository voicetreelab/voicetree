// Browser-only stub of `@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity`.
//
// The real module reads TerminalStore, fires window.hostAPI.main IPC for
// activity counts, and notifies React subscribers. The playground has no
// terminals, so all behaviour is a no-op.

export function markTerminalActivityForContextNode(_nodeId: string): void {}
export function clearActivityForTerminal(_terminalId: string): void {}
