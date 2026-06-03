/**
 * The `worktree.*` RPC contract — the VTD GATEWAY surface for git worktree
 * operations.
 *
 * Under the gateway model the browser talks ONLY to VTD; it never touches the
 * filesystem or runs git itself. VTD owns the git plumbing (it already runs on
 * the project's machine) and exposes the five worktree operations the HostAPI
 * contract needs. This module is the ONE place the daemon (server side,
 * `buildWorktreeRoutes`) and the webapp (the browser adapter) both import —
 * method-name constants, the `WorktreeInfo` wire shape, and Request/Response
 * TYPES live here so there is a single source of truth for the wire contract.
 *
 * Repo-root is IMPLICIT — a deliberate security boundary. The browser never
 * passes a filesystem path for the daemon to run git in; the daemon resolves
 * the repo root from its OWN loaded project (`graph-db-client.getProject()`),
 * so a compromised renderer cannot drive git operations against an arbitrary
 * path. This mirrors the implicit-session design of the `graph.*` gateway.
 *
 * Wire dialect is JSON-RPC 2.0 over `POST /rpc`, identical to the `graph.*`
 * gateway and the BF-376 terminal routes.
 */

// ---------------------------------------------------------------------------
// Method-name constants — single source of truth for the dotted wire names.
// ---------------------------------------------------------------------------

/**
 * Canonical dotted method names for every worktree RPC. The server binds its
 * routes against these and the browser adapter posts against them, so a rename
 * here is a single edit that both sides pick up. Mirrors `graph.*` dotted
 * naming.
 */
export const WORKTREE_METHODS = {
    list: 'worktree.list',
    create: 'worktree.create',
    remove: 'worktree.remove',
    generateName: 'worktree.generateName',
    removeCommand: 'worktree.removeCommand',
} as const

export type WorktreeMethodKey = keyof typeof WORKTREE_METHODS
export type WorktreeMethodName = (typeof WORKTREE_METHODS)[WorktreeMethodKey]

/** Iterable of the dotted names — drift tests assert "every method has a handler". */
export const WORKTREE_METHOD_NAMES: readonly WorktreeMethodName[] =
    Object.values(WORKTREE_METHODS)

// ---------------------------------------------------------------------------
// Shared wire shape.
// ---------------------------------------------------------------------------

/**
 * A linked git worktree as reported by git itself. The single source of truth
 * for the shape returned by `worktree.list` and consumed by the menu UI.
 */
export interface WorktreeInfo {
    /** Absolute path to the worktree directory. */
    readonly path: string
    /** Full branch name (e.g. "wt-fix-auth-a3k"). */
    readonly branch: string
    /** Commit hash the worktree's HEAD points at. */
    readonly head: string
    /** Display name — the branch with any "wt-" prefix stripped. */
    readonly name: string
}

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

/** List the repository's linked worktrees (the main checkout is excluded). */
export namespace WorktreeList {
    export type Request = Record<string, never>
    export type Response = readonly WorktreeInfo[]
}

/**
 * Create a worktree (and a same-named branch) under the daemon's project, then
 * return the absolute path git actually placed it at. Worktree-created hooks
 * configured in settings are applied daemon-side.
 */
export namespace WorktreeCreate {
    export interface Request {
        readonly worktreeName: string
    }
    export interface Response {
        readonly path: string
    }
}

/** Remove a worktree by path and prune stale refs. */
export namespace WorktreeRemove {
    export interface Request {
        readonly worktreePath: string
        readonly force?: boolean
    }
    export interface Response {
        readonly success: boolean
        readonly command: string
        readonly error?: string
    }
}

/** Derive a valid git branch/worktree name from a node title. */
export namespace WorktreeGenerateName {
    export interface Request {
        readonly nodeTitle: string
    }
    export interface Response {
        readonly name: string
    }
}

/** The command string that would remove a worktree (preview only — not run). */
export namespace WorktreeRemoveCommand {
    export interface Request {
        readonly worktreePath: string
        readonly force?: boolean
    }
    export interface Response {
        readonly command: string
    }
}
