import path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/app-config/paths'

/**
 * Canonical location for persisted terminal recovery metadata.
 *
 * `projectRoot` MUST be the value from `graph.getProjectRoot()` (the graph-bridge
 * canonical project root), NOT `writeFolder` and NOT `process.env.VOICETREE_VAULT_PATH`.
 * Mixing those sources is the bug that motivated this helper — see
 * openspec/changes/fix-resume-recovery-and-surviving-agents-ux/design.md decisions 1+2.
 */
export function getRecoveryMetadataDir(projectRoot: string): string {
    return path.join(getProjectDotVoicetreePath(projectRoot), 'terminals')
}
