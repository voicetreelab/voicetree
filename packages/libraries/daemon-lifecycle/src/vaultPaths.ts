import {getProjectDotVoicetreePath} from '@vt/paths'

/**
 * Canonical vault-state directory `<vault>/.voicetree`. Every daemon-
 * lifecycle artifact (owner record, spawn lock, cooldown breadcrumb)
 * resolves to a sibling under this directory.
 */
export function vaultStateDir(vaultPath: string): string {
  return getProjectDotVoicetreePath(vaultPath)
}
