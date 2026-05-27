/**
 * Canonical location for persisted terminal recovery metadata.
 *
 * `projectRoot` MUST be the value from `graph.getProjectRoot()` (the graph-bridge
 * canonical project root), NOT `writeFolder` and NOT `process.env.VOICETREE_VAULT_PATH`.
 * Mixing those sources is the bug that motivated this helper — see
 * openspec/changes/fix-resume-recovery-and-surviving-agents-ux/design.md decisions 1+2.
 *
 * Pure string concatenation (no `node:path`): the codebase is posix-only
 * (Electron + tmux on darwin/linux), and keeping this function dependency-free
 * removes a path-io import from the recovery community subgraph.
 */
export function getRecoveryMetadataDir(projectRoot: string): string {
    const trimmed: string = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot
    return `${trimmed}/.voicetree/terminals`
}
