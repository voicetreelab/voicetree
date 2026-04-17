export {
    scanMarkdownFiles,
    extractLinks,
    getNodeId,
    deriveTitle,
    resolveLinkTarget,
    buildUniqueBasenameMap,
    type StructureNode,
} from './primitives'

export {
    getGraphStructure,
    type GraphStructureOptions,
    type GraphStructureResult,
} from './graphStructure'

export {
    renderGraphView,
    type ViewFormat,
    type ViewGraphOptions,
    type ViewGraphResult,
} from './viewGraph'

export {
    dumpState,
    graphStateApply,
    type StateDumpOptions,
    type StateDumpResult,
} from './state'

export {
    liveStateDump,
    liveApply,
    liveView,
    type LiveStateDumpOptions,
    type LiveStateDumpResult,
    type LiveApplyOptions,
    type LiveApplyResult,
    type LiveViewOptions,
} from './live'

export {createLiveTransport, DEFAULT_MCP_PORT, type LiveTransport} from './liveTransport'

export {
    lintGraph,
    lintGraphWithFixes,
    buildContainmentTree,
    buildFolderIndexMap,
    classifyEdges,
    computeNodeMetrics,
    checkRules,
    formatLintReportHuman,
    formatLintReportJson,
    DEFAULT_LINT_CONFIG,
    type ContainmentTree,
    type ClassifiedEdge,
    type NodeMetrics,
    type LintResult,
    type GraphLintReport,
    type GraphLintAuthoringEntry,
    type GraphLintAuthoringReport,
    type LintConfig,
} from './graphLint'

export { graphRename } from './rename'
export { graphMove } from './move'

export {
    buildMarkdownBody,
    buildFilesystemAuthoringPlan,
    type ComplexityScore,
    type BuildMarkdownBodyParams,
    type StructureManifest,
    type FilesystemAuthoringInput,
    type FilesystemAuthoringFix,
    type FilesystemAuthoringValidationError,
    type FilesystemAuthoringPlanEntry,
    type FilesystemAuthoringReportEntry,
    type FilesystemAuthoringPlanResult,
} from './filesystemAuthoring'
