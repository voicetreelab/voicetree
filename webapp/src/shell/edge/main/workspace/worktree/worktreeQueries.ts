// Electron-main worktree operations, served by VTD over JSON-RPC.
//
// VTD owns the git plumbing (it runs on the project's machine); Electron Main
// is a CLIENT of it, exactly like the browser adapter. These wrappers post the
// `worktree.*` gateway methods through the bound VtDaemonClient and project each
// response onto the bare value the mainAPI contract returns — the SAME wire
// contract the browser's vtd-clients use, so there is one server-side
// implementation behind both hosts (the Main→VTD convergence).
//
// The `repoRoot` parameter on `listWorktrees` / `createWorktree` /
// `removeWorktree` is retained for mainAPI signature stability (the renderer
// passes the active repo root) but is intentionally IGNORED here: VTD resolves
// the repo root from its own loaded project, never from a client-supplied path
// (the worktree-contract security boundary).

import {
    WORKTREE_METHODS,
    type WorktreeInfo,
    type WorktreeCreate,
    type WorktreeGenerateName,
    type WorktreeRemove,
    type WorktreeRemoveCommand,
} from '@vt/vt-daemon-protocol'
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

export type {WorktreeInfo}

function vtdRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return getVtDaemonClient().rpc<T>(method, params)
}

/** Linked worktrees for the daemon's project (the main checkout excluded). */
export function listWorktrees(_repoRoot: string): Promise<WorktreeInfo[]> {
    return vtdRpc<WorktreeInfo[]>(WORKTREE_METHODS.list, {})
}

/** Create a worktree+branch under the daemon's project; resolves to its path. */
export async function createWorktree(_repoRoot: string, worktreeName: string): Promise<string> {
    const res: WorktreeCreate.Response = await vtdRpc(WORKTREE_METHODS.create, {worktreeName})
    return res.path
}

/** Derive a sanitized `wt-` branch name from a node title. */
export async function generateWorktreeName(nodeTitle: string): Promise<string> {
    const res: WorktreeGenerateName.Response = await vtdRpc(WORKTREE_METHODS.generateName, {nodeTitle})
    return res.name
}

/** Remove a worktree by path and prune stale refs; resolves to {success, command, error?}. */
export function removeWorktree(
    _repoRoot: string,
    worktreePath: string,
    force: boolean = false,
): Promise<WorktreeRemove.Response> {
    return vtdRpc<WorktreeRemove.Response>(WORKTREE_METHODS.remove, {worktreePath, force})
}

/** The (un-run) command string that would remove a worktree, for preview UI. */
export async function getRemoveWorktreeCommand(
    worktreePath: string,
    force: boolean = false,
): Promise<string> {
    const res: WorktreeRemoveCommand.Response = await vtdRpc(WORKTREE_METHODS.removeCommand, {worktreePath, force})
    return res.command
}
