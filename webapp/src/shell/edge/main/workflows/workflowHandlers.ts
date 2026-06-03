// Workflow / skill handlers for the Electron main process, served by VTD over
// JSON-RPC.
//
// VTD owns the single implementation (tools/workflows/workflowReader.ts) and
// exposes it over the `workflows.*` gateway routes — the same routes the
// browser adapter posts against. Electron Main reaches them through the bound
// VtDaemonClient rather than importing the reader in-process, so there is one
// host-filesystem implementation behind both runtimes (the Main→VTD
// convergence). The `WorkflowTreeNode` wire shape is re-exported (type-only) so
// renderer consumers keep importing it from this stable path.

import type {WorkflowTreeNode} from '@vt/vt-daemon/tools/workflows/workflowReader'
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

export type {WorkflowTreeNode}

/** The host's `~/brain/workflows` skill tree. */
export function listWorkflows(): Promise<WorkflowTreeNode[]> {
    return getVtDaemonClient().rpc<WorkflowTreeNode[]>('workflows.list', {})
}

/** Full markdown body of one skill file. */
export function readSkillFile(workflowPath: string): Promise<string> {
    return getVtDaemonClient().rpc<string>('workflows.readSkill', {workflowPath})
}

/** Summary (front-matter description) of one skill file. */
export function readSkillFileSummary(workflowPath: string): Promise<string> {
    return getVtDaemonClient().rpc<string>('workflows.readSkillSummary', {workflowPath})
}
