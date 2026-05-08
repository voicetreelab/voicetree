/**
 * BF-236 Phase 0 — unified folder-visibility model (types only).
 *
 * Every folder has one of three states. Default for unmapped folders is
 * 'hidden' (openspec change unified-folder-visibility, Decision 3). Setters
 * (Phase 1+) write a single row only — no mutation-time cascade. Visibility
 * rules apply at lookup time (Decision 1).
 */

/**
 * Absolute folder path WITHOUT a trailing slash, e.g. '/Users/x/notes'.
 *
 * Distinct from the legacy {@link FolderId}, which carries a trailing slash.
 * Conversion helpers live in `path.ts`.
 */
export type AbsolutePath = string

export type FolderState = 'expanded' | 'collapsed' | 'hidden'

export type FolderVisibilityState = ReadonlyMap<AbsolutePath, FolderState>
