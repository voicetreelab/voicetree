/**
 * File watcher setup and event handling.
 *
 * Handles:
 * - Creating and configuring the chokidar file watcher
 * - Setting up event listeners for file add/change/delete
 * - Retry logic for transient file system issues
 */

import { promises as fs } from "fs";
import type { Stats } from "fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import normalizePath from "normalize-path";
import type { FilePath, FSUpdate, FSDelete } from '@vt/graph-model/graph';
import { isImageNode } from '@vt/graph-model/graph';
import { handleFSEventWithStateAndUISides } from "@vt/graph-db-server/graph/handleFSEvent";
import { getWatcher, setWatcher } from "@vt/graph-db-server/state/watch-folder-store";
import { broadcastFolderTree } from "../broadcast/broadcast-folder-tree";
import { clearPendingWrite, consumeBroadcastSuppression, isPendingWrite } from "../pending-writes";

/**
 * Directories that must never surface as graph nodes even when nested inside a
 * watched project root. Mirrors `loadGraphFromDisk`'s initial-scan exclusions so
 * watch-time filtering and initial-load filtering agree — a file the cold load
 * skips must also be skipped when added later.
 *
 * Hidden directories (names starting with `.`, most notably `.voicetree/`) are
 * handled separately by the `.`-prefix check; this set covers the dotless noise
 * directories.
 */
const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    '.next',
    'dist',
    '.cache',
    '__pycache__',
    '.tox',
    '.venv',
    'venv',
    'build',
    // TODO: drop once migrate-worktrees-to-sibling.sh has run and .worktrees/ is empty.
    '.worktrees',
]);

function isExcludedDirectorySegment(segment: string): boolean {
    return segment.startsWith('.') || IGNORED_DIRECTORY_NAMES.has(segment);
}

/**
 * Returns the path segments of `filePath` that lie strictly below the nearest
 * containing watch root, or `null` if `filePath` is not inside any root.
 *
 * Relativizing against the roots is essential: a watch root may itself live
 * under a hidden ancestor (e.g. `/Users/x/.config/proj`), and segments ABOVE
 * the root must never trigger exclusion — only the project-internal path
 * matters, matching the downward-only traversal of the initial-load scanner.
 */
function segmentsBelowNearestRoot(
    filePath: string,
    watchRoots: readonly string[],
): readonly string[] | null {
    const normalizedFile: string = normalizePath(filePath);
    let bestRelative: string | null = null;
    let bestRootLength = -1;
    for (const root of watchRoots) {
        const normalizedRoot: string = normalizePath(root);
        const prefix: string = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
        if (normalizedFile === normalizedRoot) {
            // The root itself — no internal segments to inspect.
            if (normalizedRoot.length > bestRootLength) {
                bestRelative = '';
                bestRootLength = normalizedRoot.length;
            }
        } else if (normalizedFile.startsWith(prefix) && normalizedRoot.length > bestRootLength) {
            // Prefer the deepest matching root so an expanded subfolder root
            // shadows a parent root (segments are relative to the subfolder).
            bestRelative = normalizedFile.slice(prefix.length);
            bestRootLength = normalizedRoot.length;
        }
    }
    if (bestRelative === null) return null;
    return bestRelative.length === 0 ? [] : bestRelative.split('/');
}

/**
 * Builds the chokidar `ignored` predicate shared by the graph daemon watcher
 * (`daemonWatcher.mountWatcher`) and the watch-folder watcher (`setupWatcher`).
 * A single source of truth replaces the previously duplicated, hand-synced
 * inline predicates.
 *
 * A path is ignored when, with stats available, it is a NON-directory file that
 * either (a) is not a `.md`/image node, or (b) sits inside a hidden or
 * noise directory below its watch root (e.g. `.voicetree/prompts/x.md`).
 *
 * Two invariants are preserved deliberately:
 *
 *  - When chokidar invokes the predicate WITHOUT stats (notably from
 *    `FsEventsHandler._watchWithFsEvents` — the gate that decides whether to
 *    set up the macOS fsevents listener), it returns `false` (don't ignore).
 *    Using `path.extname()` as a "this is a file" heuristic there would treat
 *    any directory whose basename contains a dot (`My Project.notes`,
 *    `mktemp -d /tmp/project.XXXX`) as a file and skip the fsevents
 *    subscription, leaving `_readyCount` half-decremented so `watcher.ready`
 *    never resolves. chokidar reinvokes the predicate during the readdirp scan
 *    with stats populated, where the real filtering happens.
 *
 *  - Directories are never ignored (returns `false`), so the fsevents gate
 *    for the watch ROOT — which may legitimately be a hidden/dotted dir — is
 *    never tripped. The dot-dir exclusion applies only to the leaf files
 *    discovered inside such directories, which is sufficient to keep their
 *    `.md` files out of the graph.
 */
export function createWatchIgnorePredicate(
    watchRoots: readonly string[],
): (filePath: string, stats?: Stats) => boolean {
    return (filePath: string, stats?: Stats): boolean => {
        if (!stats) return false;
        if (stats.isDirectory()) return false;
        if (!filePath.endsWith('.md') && !isImageNode(filePath)) return true;

        const segments: readonly string[] | null = segmentsBelowNearestRoot(filePath, watchRoots);
        if (segments === null) return false;
        // Exclude when any directory segment below the root is hidden/noise.
        // The final segment is the file basename and is intentionally skipped.
        return segments.slice(0, -1).some(isExcludedDirectorySegment);
    };
}

export interface FileWatcherLogger {
    error(message?: unknown, ...optionalParams: unknown[]): void
}

export interface ReadFileWithRetryDependencies {
    readonly readTextFile: (filePath: string) => Promise<string>
    readonly wait: (delayMs: number) => Promise<void>
}

const defaultReadFileWithRetryDependencies: ReadFileWithRetryDependencies = {
    readTextFile: (filePath: string): Promise<string> => fs.readFile(filePath, 'utf8'),
    wait: (delayMs: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, delayMs);
    }),
}

export interface WatcherListenerDependencies {
    readonly readFileWithRetry: typeof readFileWithRetry
    readonly handleFSEvent: typeof handleFSEventWithStateAndUISides
    readonly broadcastFolderTree: typeof broadcastFolderTree
    readonly logger: FileWatcherLogger
}

const defaultWatcherListenerDependencies: WatcherListenerDependencies = {
    readFileWithRetry,
    handleFSEvent: handleFSEventWithStateAndUISides,
    broadcastFolderTree,
    logger: {
        error(message?: unknown, ...optionalParams: unknown[]): void {
            console.error(message, ...optionalParams);
        },
    },
}

/**
 * Read file with retry logic for transient file system issues
 * Retries with exponential backoff if file read fails
 * @param filePath - Absolute path to file
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delay - Initial delay in ms between retries (default: 100)
 * @returns Promise that resolves to file content
 */
export async function readFileWithRetry(
    filePath: string,
    maxRetries = 3,
    delay = 100,
    dependencies: ReadFileWithRetryDependencies = defaultReadFileWithRetryDependencies,
): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
            return await dependencies.readTextFile(filePath);
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            await dependencies.wait(delay * attempt);
        }
    }
    return dependencies.readTextFile(filePath);
}

export interface WatcherOptions {
    /** Use polling instead of native fs events (needed for Electron test harness). */
    readonly usePolling?: boolean
}

export async function setupWatcher(
    projectPaths: readonly FilePath[],
    watchedDir: FilePath,
    options?: WatcherOptions,
    dependencies: WatcherListenerDependencies = defaultWatcherListenerDependencies,
): Promise<void> {
    // Note: watcher is already closed in loadFolder before this is called

    // projectPaths contains all paths in the allowlist (e.g., primary project + openspec)
    // watchedDir is {loaded_dir} (base for node IDs)
    const usePolling: boolean = options?.usePolling ?? false;

    // Create new watcher - chokidar supports array of paths natively.
    // Only .md/image files below a watch root (excluding hidden/noise dirs such
    // as `.voicetree/`) become graph nodes; directories always pass through for
    // traversal. See `createWatchIgnorePredicate` for the fsevents-readiness and
    // dot-dir invariants this predicate must uphold.
    const newWatcher: FSWatcher = chokidar.watch([...projectPaths], {
        ignored: [createWatchIgnorePredicate(projectPaths)],
        persistent: true,
        ignoreInitial: true, // Skip initial scan (we already loaded the graph)
        followSymlinks: false,
        depth: 99,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        },
        // Caller may request polling when native fs events are unreliable
        // (e.g. Electron test harness).
        usePolling,
        interval: usePolling ? 100 : undefined,
        binaryInterval: usePolling ? 300 : undefined
    });
    setWatcher(newWatcher);

    // Setup event handlers for file changes
    setupWatcherListeners(watchedDir, dependencies);
}

export function setupWatcherListeners(
    watchedDir: FilePath,
    dependencies: WatcherListenerDependencies = defaultWatcherListenerDependencies,
): void {
    const currentWatcher: FSWatcher | null = getWatcher();
    if (!currentWatcher) return;

    // File added
    currentWatcher.on('add', (filePath: string) => {
        if (isPendingWrite(filePath)) {
            clearPendingWrite(filePath);
            return;
        }

        // Image files have empty content (don't read binary as UTF-8)
        const contentPromise: Promise<string> = isImageNode(filePath)
            ? Promise.resolve('')
            : dependencies.readFileWithRetry(filePath);

        void contentPromise
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Added'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                // Pass watchedDir so node IDs are relative to watched directory
                dependencies.handleFSEvent(fsUpdate, watchedDir);

                // Refresh folder tree sidebar (new file added)
                dependencies.broadcastFolderTree();
            })
            .catch(error => {
                dependencies.logger.error(`Error handling file add ${filePath}:`, error);
            });
    });

    // File changed
    currentWatcher.on('change', (filePath: string) => {
        const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath);

        // Skip image file changes - their content is always empty in the graph
        if (isImageNode(filePath)) {
            return;
        }

        void dependencies.readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Changed'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo);
            })
            .catch(error => {
                dependencies.logger.error(`Error handling file change ${filePath}:`, error);
            });
    });

    // File deleted
    currentWatcher.on('unlink', (filePath: string) => {
        if (isPendingWrite(filePath)) {
            clearPendingWrite(filePath);
            return;
        }

        const fsDelete: FSDelete = {
            type: 'Delete',
            absolutePath: filePath
        };

        // Handle FS event: compute delta, update state, broadcast to UI-edge
        dependencies.handleFSEvent(fsDelete, watchedDir);

        // Refresh folder tree sidebar (file removed)
        dependencies.broadcastFolderTree();
    });

    // Watch error
    currentWatcher.on('error', (error: unknown) => {
        dependencies.logger.error('File watcher error:', error);
    });
}
