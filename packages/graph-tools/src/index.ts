// Browser-safe exports only. graphStructure is Node.js-only but needed by Electron main process.
export {
    computeSyntheticEdgeSpecs,
    type OriginalEdgeRef,
    type SyntheticEdgeSpec,
} from './folderCollapse'

export {
    getGraphStructure,
    type GraphStructureOptions,
    type GraphStructureResult,
} from './graphStructure'
