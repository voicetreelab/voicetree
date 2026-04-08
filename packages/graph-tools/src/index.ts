// Primitives
export {
    scanMarkdownFiles,
    extractLinks,
    getNodeId,
    deriveTitle,
    resolveLinkTarget,
    buildUniqueBasenameMap,
    type StructureNode,
} from './primitives'

// Graph structure analysis
export {
    getGraphStructure,
    type GraphStructureOptions,
    type GraphStructureResult,
} from './graphStructure'

// Graph linting
export {
    lintGraph,
    buildContainmentTree,
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
    type LintConfig,
} from './graphLint'

// Rename
export { graphRename } from './rename'
export { graphMove } from './move'
