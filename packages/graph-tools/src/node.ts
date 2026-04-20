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
    liveFocus,
    liveNeighbors,
    livePath,
    type LiveStateDumpOptions,
    type LiveStateDumpResult,
    type LiveApplyOptions,
    type LiveApplyResult,
    type LiveViewOptions,
    type LiveFocusOptions,
    type LiveNeighborsOptions,
    type LivePathOptions,
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
    computeMetricsFromVault,
    computeAllMetrics,
    computeSCC,
    computeKCoreDegeneracy,
    computeArboricity,
    estimatePlanarity,
    type EdgePair,
    type GraphMetrics,
} from './graphMetrics'

export {
    selectFormat,
    buildAutoHeader,
    type FormatChoice,
    type FormatDecision,
} from './selectFormat'

export {
    renderAutoView,
    type AutoViewOptions,
} from './autoView'

export {
    findCollapseBoundary,
    countVisibleEntities,
    type CollapseBoundaryNode,
    type CollapseBoundaryGraph,
    type CollapseCluster,
    type CollapseStrategy,
    type FindCollapseBoundaryOptions,
} from './collapseBoundary'

export {
    createHeadlessServer,
    type HeadlessServerOptions,
    type HeadlessServer,
} from './headlessServer'

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
