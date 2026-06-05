import type {GraphBridge, ToolBridges} from '../../src/config/toolBridges.ts'

function unsupportedBridgeCall(): never {
    throw new Error('This test does not exercise graph-bridged RPC routes.')
}

export function buildDisabledToolBridges(): ToolBridges {
    const graph: GraphBridge = {
        getGraph: async () => unsupportedBridgeCall(),
        getProjectPaths: async () => unsupportedBridgeCall(),
        getWriteFolderPath: async () => unsupportedBridgeCall(),
        applyGraphDelta: async () => unsupportedBridgeCall(),
    }

    return {graph}
}
