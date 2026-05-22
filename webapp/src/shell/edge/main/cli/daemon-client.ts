// CLI-side daemon client.
//
// Thin wrapper over @vt/vt-rpc that preserves the contract callers used to
// have against the prior UDS client:
//   - returns the parsed tool payload on success
//   - throws Error with message = JSON-stringified payload when the tool
//     handler reports failure (code -32003)
//   - throws Error with rpc.message for other JSON-RPC errors
//   - throws DaemonUnreachable when the daemon URL doesn't resolve or 401s
//
// Step 9c will own the broader CLI rewrite (config flags, error mapping
// beyond -32003, retry behaviour). This file is the minimum needed to keep
// the existing CLI surfaces compiling against the new HTTP daemon.

import {createRpcClient, DaemonAuthRequired, DaemonUnreachable, type JsonRpcResponse} from '@vt/vt-rpc'

export {DaemonUnreachable, DaemonAuthRequired}

let requestSequence: number = 0
function nextRequestId(): number {
    requestSequence += 1
    return requestSequence
}

export async function callDaemon(
    toolName: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    const client = await createRpcClient()
    const response: JsonRpcResponse = await client.call(toolName, args, nextRequestId())

    if ('error' in response) {
        if (response.error.code === -32003 && response.error.data !== undefined) {
            throw new Error(JSON.stringify(response.error.data))
        }
        throw new Error(response.error.message)
    }

    return response.result
}
