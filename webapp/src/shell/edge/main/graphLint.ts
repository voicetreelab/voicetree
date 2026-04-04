// Re-export shim: implementation has moved to @vt/graph-tools
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
} from '@vt/graph-tools'
