// Re-export shim — actual implementation in @vt/graph-db-server
export {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI,
    applyGraphDeltaToDBThroughMemAndUI,
} from '@vt/graph-db-server/graph/applyGraphDelta'
