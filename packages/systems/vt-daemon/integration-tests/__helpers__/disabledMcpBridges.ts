import type {GraphBridge, McpToolBridges} from '../../src/config/mcpBridges.ts'

function unsupportedBridgeCall(): never {
    throw new Error('This test does not exercise graph-bridged MCP routes.')
}

export function buildDisabledMcpBridges(): McpToolBridges {
    const graph: GraphBridge = {
        getGraph: async () => unsupportedBridgeCall(),
        getVaultPaths: async () => unsupportedBridgeCall(),
        getWriteFolderPath: async () => unsupportedBridgeCall(),
        applyGraphDelta: async () => unsupportedBridgeCall(),
    }

    return {graph}
}
