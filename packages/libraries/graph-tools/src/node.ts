export {
    scanMarkdownFiles,
    extractLinks,
    getNodeId,
    deriveTitle,
    resolveLinkTarget,
    buildUniqueBasenameMap,
    type StructureNode,
} from './core/primitives'


export {
    renderGraphView,
    type ViewFormat,
    type ViewGraphOptions,
    type ViewGraphResult,
} from './view/viewGraph'

export {
    dumpState,
    graphStateApply,
    type StateDumpOptions,
    type StateDumpResult,
} from './live/state'

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
} from './live/live'

export {createLiveTransport, DaemonUnreachable, type LiveTransport} from './live/liveTransport'

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
} from './lint/graphLint'

export { graphRename } from './authoring/rename'
export { graphMove } from './authoring/move'
export { graphGroup } from './authoring/group'

export {
    computeMetricsFromVault,
    computeAllMetrics,
    computeSCC,
    computeKCoreDegeneracy,
    computeArboricity,
    estimatePlanarity,
    type EdgePair,
    type GraphMetrics,
} from './view/graphMetrics'

export {
    selectFormat,
    buildAutoHeader,
    type FormatChoice,
    type FormatDecision,
} from './view/selectFormat'

export {
    renderAutoView,
    type AutoViewOptions,
} from './view/autoView'

export {
    findCollapseBoundary,
    countVisibleEntities,
    type CollapseBoundaryNode,
    type CollapseBoundaryGraph,
    type CollapseCluster,
    type CollapseStrategy,
    type FindCollapseBoundaryOptions,
} from './view/collapseBoundary'

export {
    createHeadlessServer,
    type HeadlessServerOptions,
    type HeadlessServer,
} from './live/headlessServer'

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
} from './authoring/filesystemAuthoring'

export {extractExistingParentRefs} from './authoring/authoringFixes'
