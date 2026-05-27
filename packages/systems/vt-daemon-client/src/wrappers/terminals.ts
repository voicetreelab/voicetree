/**
 * Typed RPC wrappers for the "terminals" domain — the 12 routes that
 * `terminalRuntimeSurface` used to expose for terminal lifecycle, input,
 * read-state, headless management, and registry mutations. Grouped under
 * one facade because the call sites already think of them as "the
 * terminal-runtime surface"; sub-grouping under design.md §1's eight
 * sub-headings would add chatter at the call site without any boundary
 * difference behind the wire.
 *
 * Each wrapper is a deep function: it owns the JSON-RPC envelope shape,
 * the params widening, and the result narrowing. Callers see only the
 * `Request → Promise<Response>` arrow declared in `@vt/vt-daemon-protocol`.
 *
 * Forbidden by design.md §7 closure invariant: this module must not
 * import from `@vt/agent-runtime`. Every type comes from
 * `@vt/vt-daemon-protocol`.
 */

import type {
    CloseHeadlessAgent,
    GetExistingAgentNames,
    GetHeadlessAgentOutput,
    GetTerminalRecords,
    GetUnseenNodesForTerminal,
    InjectNodesIntoTerminal,
    PatchTerminalRecord,
    RemoveTerminalFromRegistry,
    SendTextToTerminal,
    SpawnPlainTerminal,
    SpawnPlainTerminalWithNode,
    SpawnTerminalWithContextNode,
    TerminalOperationResult,
    TerminalRecord,
    UnseenNodeInfo,
} from '@vt/vt-daemon-protocol'

import type {VtDaemonClient} from '../VtDaemonClient.ts'
import {asParams} from './params.ts'

// ----------------------------------------------------------------------------
// Spawn family (3)
// ----------------------------------------------------------------------------

export async function spawnPlainTerminal(
    client: VtDaemonClient,
    request: SpawnPlainTerminal.Request,
): Promise<void> {
    await client.rpc<null>('spawnPlainTerminal', asParams(request))
}

export async function spawnPlainTerminalWithNode(
    client: VtDaemonClient,
    request: SpawnPlainTerminalWithNode.Request,
): Promise<void> {
    await client.rpc<null>('spawnPlainTerminalWithNode', asParams(request))
}

export async function spawnTerminalWithContextNode(
    client: VtDaemonClient,
    request: SpawnTerminalWithContextNode.Request,
): Promise<SpawnTerminalWithContextNode.Response> {
    return client.rpc<SpawnTerminalWithContextNode.Response>(
        'spawnTerminalWithContextNode',
        asParams(request),
    )
}

// ----------------------------------------------------------------------------
// Inject / send (2)
// ----------------------------------------------------------------------------

export async function sendTextToTerminal(
    client: VtDaemonClient,
    request: SendTextToTerminal.Request,
): Promise<TerminalOperationResult> {
    return client.rpc<TerminalOperationResult>('sendTextToTerminal', asParams(request))
}

export async function injectNodesIntoTerminal(
    client: VtDaemonClient,
    request: InjectNodesIntoTerminal.Request,
): Promise<InjectNodesIntoTerminal.Response> {
    return client.rpc<InjectNodesIntoTerminal.Response>(
        'injectNodesIntoTerminal',
        asParams(request),
    )
}

// ----------------------------------------------------------------------------
// Read state (3)
// ----------------------------------------------------------------------------

export async function getTerminalRecords(
    client: VtDaemonClient,
    request: GetTerminalRecords.Request = {},
): Promise<readonly TerminalRecord[]> {
    return client.rpc<readonly TerminalRecord[]>('getTerminalRecords', asParams(request))
}

export async function getUnseenNodesForTerminal(
    client: VtDaemonClient,
    request: GetUnseenNodesForTerminal.Request,
): Promise<readonly UnseenNodeInfo[]> {
    return client.rpc<readonly UnseenNodeInfo[]>(
        'getUnseenNodesForTerminal',
        asParams(request),
    )
}

export async function getExistingAgentNames(
    client: VtDaemonClient,
    request: GetExistingAgentNames.Request = {},
): Promise<readonly string[]> {
    return client.rpc<readonly string[]>('getExistingAgentNames', asParams(request))
}

// ----------------------------------------------------------------------------
// Headless agents (2)
// ----------------------------------------------------------------------------

export async function closeHeadlessAgent(
    client: VtDaemonClient,
    request: CloseHeadlessAgent.Request,
): Promise<CloseHeadlessAgent.Response> {
    return client.rpc<CloseHeadlessAgent.Response>('closeHeadlessAgent', asParams(request))
}

export async function getHeadlessAgentOutput(
    client: VtDaemonClient,
    request: GetHeadlessAgentOutput.Request,
): Promise<string> {
    return client.rpc<string>('getHeadlessAgentOutput', asParams(request))
}

// ----------------------------------------------------------------------------
// Registry management (2)
// ----------------------------------------------------------------------------

export async function removeTerminalFromRegistry(
    client: VtDaemonClient,
    request: RemoveTerminalFromRegistry.Request,
): Promise<void> {
    await client.rpc<null>('removeTerminalFromRegistry', asParams(request))
}

export async function patchTerminalRecord(
    client: VtDaemonClient,
    request: PatchTerminalRecord.Request,
): Promise<void> {
    await client.rpc<null>('patchTerminalRecord', asParams(request))
}

// ----------------------------------------------------------------------------
// Bound facade
// ----------------------------------------------------------------------------

/**
 * The bound surface a webapp caller sees at
 * `vtdClient.terminals.<methodName>`. Each method closes over the
 * `VtDaemonClient` so call sites pass only the Request — the client is
 * an ambient binding of the active vt-daemon connection.
 */
export interface TerminalsFacade {
    readonly spawnPlainTerminal: (request: SpawnPlainTerminal.Request) => Promise<void>
    readonly spawnPlainTerminalWithNode: (request: SpawnPlainTerminalWithNode.Request) => Promise<void>
    readonly spawnTerminalWithContextNode: (
        request: SpawnTerminalWithContextNode.Request,
    ) => Promise<SpawnTerminalWithContextNode.Response>
    readonly sendTextToTerminal: (
        request: SendTextToTerminal.Request,
    ) => Promise<TerminalOperationResult>
    readonly injectNodesIntoTerminal: (
        request: InjectNodesIntoTerminal.Request,
    ) => Promise<InjectNodesIntoTerminal.Response>
    readonly getTerminalRecords: (request?: GetTerminalRecords.Request) => Promise<readonly TerminalRecord[]>
    readonly getUnseenNodesForTerminal: (
        request: GetUnseenNodesForTerminal.Request,
    ) => Promise<readonly UnseenNodeInfo[]>
    readonly getExistingAgentNames: (
        request?: GetExistingAgentNames.Request,
    ) => Promise<readonly string[]>
    readonly closeHeadlessAgent: (
        request: CloseHeadlessAgent.Request,
    ) => Promise<CloseHeadlessAgent.Response>
    readonly getHeadlessAgentOutput: (
        request: GetHeadlessAgentOutput.Request,
    ) => Promise<string>
    readonly removeTerminalFromRegistry: (
        request: RemoveTerminalFromRegistry.Request,
    ) => Promise<void>
    readonly patchTerminalRecord: (request: PatchTerminalRecord.Request) => Promise<void>
}

export function bindTerminalsFacade(client: VtDaemonClient): TerminalsFacade {
    return {
        spawnPlainTerminal: (request) => spawnPlainTerminal(client, request),
        spawnPlainTerminalWithNode: (request) =>
            spawnPlainTerminalWithNode(client, request),
        spawnTerminalWithContextNode: (request) =>
            spawnTerminalWithContextNode(client, request),
        sendTextToTerminal: (request) => sendTextToTerminal(client, request),
        injectNodesIntoTerminal: (request) => injectNodesIntoTerminal(client, request),
        getTerminalRecords: (request) => getTerminalRecords(client, request),
        getUnseenNodesForTerminal: (request) =>
            getUnseenNodesForTerminal(client, request),
        getExistingAgentNames: (request) => getExistingAgentNames(client, request),
        closeHeadlessAgent: (request) => closeHeadlessAgent(client, request),
        getHeadlessAgentOutput: (request) => getHeadlessAgentOutput(client, request),
        removeTerminalFromRegistry: (request) =>
            removeTerminalFromRegistry(client, request),
        patchTerminalRecord: (request) => patchTerminalRecord(client, request),
    }
}

