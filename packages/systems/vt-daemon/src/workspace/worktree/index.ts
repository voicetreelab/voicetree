// Public surface of the worktree module. Consumers import from
// `@vt/vt-daemon/workspace/worktree` (an explicit package export) rather than
// reaching into individual files, so the internal split (placement / git
// internals / command surface) stays private and refactorable.

export {
    generateWorktreeName,
    createWorktree,
    listWorktrees,
    removeWorktree,
    getRemoveWorktreeCommand,
} from './gitWorktreeCommands.ts'
export type { WorktreeInfo } from './gitWorktreeCommands.ts'
export { createWorktreeWithHooks } from './createWorktreeWithHooks.ts'
