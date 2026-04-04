import type { SavedProject } from './types';

/**
 * Sorts projects by lastOpened timestamp in descending order (most recent first).
 * Does not mutate the original array.
 */
export function sortProjectsByLastOpened(projects: readonly SavedProject[]): readonly SavedProject[] {
    return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}
