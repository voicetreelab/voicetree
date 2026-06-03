// Workflow / skill RPC routes (3): workflows.list, workflows.readSkill,
// workflows.readSkillSummary. These let the browser adapter reach the host's
// `~/brain/workflows` skill tree — the same feature the Electron renderer gets
// by calling the reader directly. Read-only host-filesystem queries; the reader
// (tools/workflows/workflowReader.ts) is the single source of truth shared with
// the Electron main process.

import {z} from 'zod'

import {
    listWorkflows,
    readSkillFile,
    readSkillFileSummary,
} from '@vt/vt-daemon/tools/workflows/workflowReader.ts'
import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const listWorkflowsRoute: RpcRoute = {
    name: 'workflows.list',
    handler: async (): Promise<McpToolResponse> =>
        buildJsonResponse(await listWorkflows()),
}

const readSkillRoute: RpcRoute = {
    name: 'workflows.readSkill',
    inputShape: {workflowPath: z.string()},
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        buildJsonResponse(await readSkillFile(args.workflowPath as string)),
}

const readSkillSummaryRoute: RpcRoute = {
    name: 'workflows.readSkillSummary',
    inputShape: {workflowPath: z.string()},
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        buildJsonResponse(await readSkillFileSummary(args.workflowPath as string)),
}

export const WORKFLOW_ROUTES: readonly RpcRoute[] = [
    listWorkflowsRoute,
    readSkillRoute,
    readSkillSummaryRoute,
] as const
