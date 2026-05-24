/**
 * Hierarchical community assignment helpers.
 *
 * A "community" is a node in the directory containment tree:
 *   depth 0 → the package itself (e.g. `graph-db-server`)
 *   depth 1 → first-level subdirectory under `src/` (e.g. `graph-db-server/state`)
 *   depth N → Nth-level subdirectory
 *
 * Files that live shallower than the requested depth are placed in a
 * synthetic `__root__` bucket at that depth so every file maps to exactly
 * one community at every depth — this keeps cross-depth comparisons honest.
 *
 * These helpers are the single source of truth for community assignment.
 * The structural-orange (hierarchical-complexity), behavioral-orange
 * (behavioral-complexity), and semantic-coupling measures all depend on
 * byte-identical behaviour here; do not fork.
 */
import {dirname} from 'node:path'
import type {SourceFile} from '../graph/import-graph.ts'

/**
 * Map a (package, file) pair to its community at the given depth.
 *
 * @param pkg     The package directory name (e.g. `graph-db-server`).
 * @param relToSrc The file path relative to the package's `src/` root
 *                 (e.g. `state/graph-store.ts`).
 * @param depth   Containment depth — 0 returns just the package; N returns
 *                package + first N directory segments.
 */
export function communityAtDepth(pkg: string, relToSrc: string, depth: number): string {
    if (depth === 0) return pkg
    const dir = dirname(relToSrc)
    const parts = dir === '.' ? [] : dir.split('/')
    const segments = parts.slice(0, depth)
    if (segments.length < depth) return [pkg, ...segments, '__root__'].join('/')
    return [pkg, ...segments].join('/')
}

/**
 * Given a community id at a given depth, return the parent community id
 * one level up. Sibling groups are the set of communities sharing a parent.
 *
 * Mirrors `communityAtDepth(pkg, _, depth - 1)` for any community produced
 * by `communityAtDepth`.
 */
export function siblingGroupParent(communityId: string, depth: number): string {
    if (depth <= 1) {
        const slash = communityId.indexOf('/')
        return slash === -1 ? communityId : communityId.slice(0, slash)
    }
    const parts = communityId.split('/')
    return parts.slice(0, depth).join('/')
}

/**
 * Convenience wrapper for callers that already hold a {@link SourceFile}.
 * Spike-note: every existing caller had a SourceFile in hand, so this
 * removes the pkg/relToSrc unpacking ritual at the call site.
 */
export function communityForFile(file: SourceFile, depth: number): string {
    return communityAtDepth(file.packageName, file.relToSrc, depth)
}
