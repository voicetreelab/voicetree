import {getProjectDotVoicetreePath} from '@vt/paths'

/**
 * Canonical project-state directory `<project>/.voicetree`. Every daemon-
 * lifecycle artifact (owner record, spawn lock, cooldown breadcrumb)
 * resolves to a sibling under this directory.
 */
export function projectStateDir(projectPath: string): string {
  return getProjectDotVoicetreePath(projectPath)
}
