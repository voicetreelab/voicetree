// Shared transport-layer surface types for the unified HTTP daemon.
// Split out of httpServer.ts so siblings (rpcDispatch, hookDispatch, the
// health probe handler) can reference them without forcing the route
// surface back through the router file.

import type {McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import type {EventSubscriptionHub} from './eventSubscriptionHub.ts'

export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResponse>
export type ToolCatalog = ReadonlyMap<string, ToolHandler>

export interface HookHandlerInvocation {
    readonly source: string
    readonly terminalId: string | undefined
    readonly eventName: string | undefined
}

export type HookHandler = (invocation: HookHandlerInvocation) => unknown

export interface AccessLogger {
    readonly logRequest: (line: string) => void
    readonly logError: (line: string, error?: unknown) => void
}

export interface HttpDaemonServerHandle {
    readonly port: number
    readonly url: string
    readonly hub: EventSubscriptionHub
    readonly stop: () => Promise<void>
}
