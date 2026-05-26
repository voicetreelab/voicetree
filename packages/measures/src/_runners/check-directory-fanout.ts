#!/usr/bin/env node
// Impure edge: refuses any commit where a source directory has exceeded the
// `MAX_DIRECTORY_CHILDREN` fanout limit. Invoked by capture-ci-checks
// (tier-0 pre-commit). Pure policy + formatter live in
// _shared/shape/directory-fanout.ts; directory enumeration is delegated to
// the existing `walkDirectories` helper so this runner doesn't grow its
// own fs/path-io implicit-global dependencies.
//
// Scope: the whole-repo scan rather than a staged-files diff is intentional —
// a directory becomes "wrong" the moment it crosses 15 children regardless
// of who added the offending file in this commit. A diff-scoped check would
// let earlier in-flight work commit and shift the blame onto an innocent
// later commit; the wider scan errors at the first attempt instead.

import {discoverPackages, DEFAULT_REPO_ROOT} from '../_shared/discovery/discover-packages.ts'
import {
    IGNORED_DIRECTORY_NAMES,
    findFanoutViolations,
    formatFanoutReport,
    type DirectoryFanout,
} from '../_shared/shape/directory-fanout.ts'
import {walkDirectories} from '../_shared/walk-directories.ts'

async function scanFanouts(root: string, repoRoot: string): Promise<DirectoryFanout[]> {
    const walked = await walkDirectories(root, {
        includeEntry: entry => !(entry.kind === 'directory' && IGNORED_DIRECTORY_NAMES.has(entry.name)),
    })
    return walked.map(directory => ({
        directory: directory.absolutePath.slice(repoRoot.length + 1),
        childCount: directory.entries.length,
        children: directory.entries.map(entry => entry.name),
    }))
}

async function main(): Promise<void> {
    const packages = await discoverPackages()
    const sourceRoots = packages.map(pkg => pkg.srcRoot).sort()
    const fanouts = (await Promise.all(
        sourceRoots.map(root => scanFanouts(root, DEFAULT_REPO_ROOT)),
    )).flat()
    const violations = findFanoutViolations(fanouts)
    if (violations.length === 0) {
        process.exit(0)
    }
    process.stderr.write(formatFanoutReport(violations))
    process.exit(1)
}

main()
