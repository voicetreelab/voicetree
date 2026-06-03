// Workflow / skill handlers for the Electron main process.
//
// The implementation now lives in vt-daemon (tools/workflows/workflowReader.ts)
// so it is the single source of truth shared by the Electron main process
// (these direct imports) and browser mode (the `workflows.*` JSON-RPC routes).
// Re-exported here to keep the existing `@/shell/edge/main/workflows/...`
// import sites stable.

export {
    listWorkflows,
    readSkillFile,
    readSkillFileSummary,
    type WorkflowTreeNode,
} from '@vt/vt-daemon/tools/workflows/workflowReader'
