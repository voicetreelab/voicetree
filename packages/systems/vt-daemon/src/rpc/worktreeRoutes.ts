// The `worktree.*` gateway RPC routes. VTD owns the git plumbing; these routes
// let the browser drive the five worktree operations the HostAPI contract needs
// without ever touching the filesystem itself.
//
// Repo-root is resolved daemon-side from the loaded project (deps.getRepoRoot),
// NOT supplied by the client — the browser cannot point git at an arbitrary
// path. This mirrors the implicit-session design of the `graph.*` gateway: like
// those routes, they need a per-boot dependency (here the live graph-db-client
// to read the project root), so they are produced by a factory whose deps are
// injected at the edge and registered on the internal RPC bucket via
// `buildCatalogDispatchMap(bridges, extraRoutes)`.

import {z} from 'zod'

import {
    GATEWAY_METHODS,
    type WorktreeCreate,
    type WorktreeRemove,
    type WorktreeGenerateName,
    type WorktreeRemoveCommand,
    type WorktreeList,
} from '@vt/vt-daemon-protocol'

import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import type {RpcRoute} from './RpcRoute.ts'
import {
    listWorktrees,
    removeWorktree,
    generateWorktreeName,
    getRemoveWorktreeCommand,
} from '../workspace/worktree/gitWorktreeCommands.ts'
import {createWorktreeWithHooks} from '../workspace/worktree/createWorktreeWithHooks.ts'

export interface WorktreeRoutesDeps {
    /**
     * Resolve the repository root the worktree operations act on. Read from the
     * daemon's loaded project (graphd's authoritative `projectRoot`), never from
     * the client — the gateway does not trust client-supplied filesystem paths.
     */
    readonly getRepoRoot: () => Promise<string>
}

const M = GATEWAY_METHODS.worktree

export function buildWorktreeRoutes(deps: WorktreeRoutesDeps): readonly RpcRoute[] {
    const {getRepoRoot} = deps

    return [
        {
            name: M.list,
            handler: async (): Promise<McpToolResponse> => {
                const repoRoot: string = await getRepoRoot()
                const result: WorktreeList.Response = await listWorktrees(repoRoot)
                return buildJsonResponse(result)
            },
        },
        {
            name: M.create,
            inputShape: {worktreeName: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {worktreeName} = args as unknown as WorktreeCreate.Request
                const repoRoot: string = await getRepoRoot()
                const path: string = await createWorktreeWithHooks(repoRoot, worktreeName)
                const response: WorktreeCreate.Response = {path}
                return buildJsonResponse(response)
            },
        },
        {
            name: M.remove,
            inputShape: {worktreePath: z.string(), force: z.boolean().optional()},
            handler: async (args): Promise<McpToolResponse> => {
                const {worktreePath, force} = args as unknown as WorktreeRemove.Request
                const repoRoot: string = await getRepoRoot()
                const result: WorktreeRemove.Response = await removeWorktree(repoRoot, worktreePath, force ?? false)
                return buildJsonResponse(result)
            },
        },
        {
            name: M.generateName,
            inputShape: {nodeTitle: z.string()},
            handler: async (args): Promise<McpToolResponse> => {
                const {nodeTitle} = args as unknown as WorktreeGenerateName.Request
                const response: WorktreeGenerateName.Response = {name: generateWorktreeName(nodeTitle)}
                return buildJsonResponse(response)
            },
        },
        {
            name: M.removeCommand,
            inputShape: {worktreePath: z.string(), force: z.boolean().optional()},
            handler: async (args): Promise<McpToolResponse> => {
                const {worktreePath, force} = args as unknown as WorktreeRemoveCommand.Request
                const response: WorktreeRemoveCommand.Response = {
                    command: getRemoveWorktreeCommand(worktreePath, force ?? false),
                }
                return buildJsonResponse(response)
            },
        },
    ]
}
