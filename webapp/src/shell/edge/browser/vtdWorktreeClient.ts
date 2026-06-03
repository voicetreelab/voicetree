// Typed VTD `worktree.*` gateway client for the browser adapter. Mirrors
// vtdGraphClient.ts: thin wrappers over callVtdRpc that name the dotted method
// (from the protocol's WORKTREE_METHODS) and project each response onto the
// bare value the HostAPI contract returns. The daemon resolves the repo root
// from its own loaded project, so none of these carry a filesystem path for the
// listing/creation ops — only the worktree path for remove/preview, which the
// caller obtained from a prior `list`.

import {callVtdRpc} from './vtdRpc'
import {
    WORKTREE_METHODS,
    type WorktreeInfo,
    type WorktreeCreate,
    type WorktreeGenerateName,
    type WorktreeRemove,
    type WorktreeRemoveCommand,
} from '@vt/vt-daemon-protocol'

/** Linked worktrees for the daemon's project (main checkout excluded). */
export function vtdListWorktrees(vtdUrl: string, token: string): Promise<readonly WorktreeInfo[]> {
    return callVtdRpc(vtdUrl, token, WORKTREE_METHODS.list, {})
}

/** Create a worktree+branch; resolves to the absolute path git placed it at. */
export async function vtdCreateWorktree(vtdUrl: string, token: string, worktreeName: string): Promise<string> {
    const res = await callVtdRpc<WorktreeCreate.Response>(vtdUrl, token, WORKTREE_METHODS.create, {worktreeName})
    return res.path
}

/** Derive a sanitized `wt-` branch name from a node title. */
export async function vtdGenerateWorktreeName(vtdUrl: string, token: string, nodeTitle: string): Promise<string> {
    const res = await callVtdRpc<WorktreeGenerateName.Response>(vtdUrl, token, WORKTREE_METHODS.generateName, {nodeTitle})
    return res.name
}

/** Remove a worktree by path; resolves to {success, command, error?}. */
export function vtdRemoveWorktree(
    vtdUrl: string,
    token: string,
    worktreePath: string,
    force: boolean,
): Promise<WorktreeRemove.Response> {
    return callVtdRpc(vtdUrl, token, WORKTREE_METHODS.remove, {worktreePath, force})
}

/** The (un-run) command string that would remove a worktree, for preview UI. */
export async function vtdRemoveWorktreeCommand(
    vtdUrl: string,
    token: string,
    worktreePath: string,
    force: boolean,
): Promise<string> {
    const res = await callVtdRpc<WorktreeRemoveCommand.Response>(vtdUrl, token, WORKTREE_METHODS.removeCommand, {worktreePath, force})
    return res.command
}
