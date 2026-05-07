import type { DiscoveredProject, SavedProject } from './types';

/**
 * Filters out discovered projects that are already in the saved projects list.
 * Comparison is done by path.
 */
export function filterDiscoveredProjects(
    discovered: readonly DiscoveredProject[],
    saved: readonly SavedProject[]
): readonly DiscoveredProject[] {
    const savedPaths: ReadonlySet<string> = new Set(saved.map((p) => p.path));
    return discovered.filter((d) => !savedPaths.has(d.path));
}
