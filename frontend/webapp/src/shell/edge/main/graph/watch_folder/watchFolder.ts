import {loadGraphFromDisk, loadVaultPathAdditively} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import type {FilePath, Graph, GraphDelta, FSDelete, GraphNode, DeleteNode} from "@/pure/graph";
import {createGraph} from "@/pure/graph";
import type {FileLimitExceededError} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce";
import {setGraph, getGraph} from "@/shell/edge/main/state/graph-store";
import {app, dialog} from "electron";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import {promises as fs} from "fs";
import fsSync from "fs";
import chokidar, {type FSWatcher} from "chokidar";
import type {FSUpdate} from "@/pure/graph";
import type {Stats} from "fs";
import {handleFSEventWithStateAndUISides} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/handleFSEventWithStateAndUISides";
import {mapNewGraphToDelta} from "@/pure/graph";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";
import {notifyTextToTreeServerOfDirectory} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/notifyTextToTreeServerOfDirectory";
import {getOnboardingDirectory} from "@/shell/edge/main/electron/onboarding-setup";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import {uiAPI} from "@/shell/edge/main/ui-api-proxy";
import {loadSettings} from "@/shell/edge/main/settings/settings_IO";
import {type VTSettings} from "@/pure/settings/types";

// THIS FUNCTION takes absolutePath
// returns graph
// has side effects of sending to UI-edge
// setting up file watchers
// closing old watchers

let watcher: FSWatcher | null = null;

let watchedDirectory: FilePath | null = null;

/**
 * Get all vault paths in the allowlist.
 * Reads directly from config file (source of truth).
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    if (!watchedDirectory) return [];
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDirectory);
    return config?.allowlist ?? [];
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the primary vault path if not explicitly set.
 */
export async function getWritePath(): Promise<O.Option<FilePath>> {
    if (!watchedDirectory) return O.none;
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDirectory);
    if (config?.writePath) {
        return O.some(config.writePath);
    }
    // Fallback to primary vault path (backward compatibility)
    return getVaultPath();
}

/**
 * Set the write path. Must be in the allowlist.
 */
export async function setWritePath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    if (!watchedDirectory) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDirectory);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    if (!config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path must be in the allowlist' };
    }

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDirectory, {
        allowlist: config.allowlist,
        writePath: vaultPath
    });

    // Notify backend so it writes new nodes to the correct directory
    notifyTextToTreeServerOfDirectory(vaultPath);

    return { success: true };
}

/**
 * Add a vault path to the allowlist.
 * If the path doesn't exist, it will be created.
 * Automatically loads files from the new path into the graph and adds to watcher.
 *
 * Uses bulk load path (loadVaultPathAdditively) for efficiency:
 * - Single UI broadcast instead of N broadcasts
 * - No floating editors auto-opened (bulk load behavior)
 * - Consistent with initial loadGraphFromDisk pattern
 */
export async function addVaultPathToAllowlist(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    if (!watchedDirectory) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDirectory);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    // Check if already in allowlist
    if (config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path already in allowlist' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const newAllowlist: readonly string[] = [...config.allowlist, vaultPath];

    // Load files from the new path into the graph using bulk load path
    const existingGraph: Graph = getGraph();

    // Use bulk load path: single pass, single broadcast, no editors auto-opened
    const loadResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
        await loadVaultPathAdditively(vaultPath, existingGraph);

    if (E.isLeft(loadResult)) {
        return { success: false, error: `File limit exceeded: ${loadResult.left.fileCount} files` };
    }

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDirectory, {
        allowlist: newAllowlist,
        writePath: config.writePath
    });

    const { graph: mergedGraph, delta } = loadResult.right;

    // Update graph state
    setGraph(mergedGraph);

    // Single broadcast to UI (no editors auto-opened for bulk loads)
    if (delta.length > 0) {
        applyGraphDeltaToMemState(delta);
        broadcastGraphDeltaToUI(delta);
    }

    // Add the new path to the watcher
    if (watcher) {
        watcher.add(vaultPath);
    }

    return { success: true };
}

/**
 * Remove a vault path from the allowlist.
 * Cannot remove the default write path.
 * Immediately removes nodes from that vault from the graph.
 */
export async function removeVaultPathFromAllowlist(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    if (!watchedDirectory) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDirectory);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    if (!config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path not in allowlist' };
    }

    if (vaultPath === config.writePath) {
        return { success: false, error: 'Cannot remove write path' };
    }

    // Remove nodes from the graph that belong to this vault path
    const relativePath: string = path.relative(watchedDirectory, vaultPath);
    const currentGraph: Graph = getGraph();

    // Find nodes whose ID starts with this vault's relative path
    const nodesToRemove: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
        nodeId.startsWith(relativePath + '/') || nodeId === relativePath
    );

    if (nodesToRemove.length > 0) {
        // Create delete deltas for each node
        const deleteDelta: GraphDelta = nodesToRemove.map((nodeId): DeleteNode => ({
            type: 'DeleteNode',
            nodeId,
            deletedNode: O.some(currentGraph.nodes[nodeId])
        }));

        // Apply to memory state and broadcast to UI (but NOT to DB - files still exist)
        applyGraphDeltaToMemState(deleteDelta);
        broadcastGraphDeltaToUI(deleteDelta);

        // Fit viewport to remaining nodes after vault removal
        uiAPI.fitViewport();
    }

    const newAllowlist: readonly string[] = config.allowlist.filter((p: string) => p !== vaultPath);

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDirectory, {
        allowlist: newAllowlist,
        writePath: config.writePath
    });

    return { success: true };
}

// CLI argument override for opening a specific folder on startup (used by "Open Folder in New Instance")
let startupFolderOverride: string | null = null;

export function setStartupFolderOverride(folderPath: string): void {
    startupFolderOverride = folderPath;
}

// Cleanup callback for resources that need to be disposed when switching folders (e.g., terminals)
let onFolderSwitchCleanup: (() => void) | null = null;

export function setOnFolderSwitchCleanup(cleanup: () => void): void {
    onFolderSwitchCleanup = cleanup;
}

export async function initialLoad(): Promise<void>  {
    // Check for CLI-specified folder first (from "Open Folder in New Instance")
    if (startupFolderOverride !== null) {
        await loadFolder(startupFolderOverride);
        return;
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value)
    } else {
        // First run: load onboarding directory
        const onboardingPath: string = getOnboardingDirectory();
        await loadFolder(onboardingPath);
    }
}

function getConfigPath(): string {
    const userDataPath: string = app.getPath('userData');
    return path.join(userDataPath, 'voicetree-config.json');
}

// Load last watched directory from config
async function getLastDirectory(): Promise<O.Option<FilePath>> {
    const configPath: string = getConfigPath();
    return fs.readFile(configPath, 'utf8')
        .then(data => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const config: any = JSON.parse(data);
            return O.fromNullable(config.lastDirectory as FilePath | null | undefined);
        })
        .catch((error) => {
            console.error("getLastDirectory", error);
            // Config file doesn't exist yet (first run) - return None
            return O.none;
        });
}

// Config structure: { lastDirectory, vaultConfig }
// Mutable version for internal use (we mutate before saving)
import type { VaultConfig } from "@/pure/settings/types";

interface VoiceTreeConfig {
    lastDirectory?: string;
    vaultConfig?: { [folderPath: string]: VaultConfig };
}

async function loadConfig(): Promise<VoiceTreeConfig> {
    const configPath: string = getConfigPath();
    try {
        const data: string = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data) as VoiceTreeConfig;
    } catch {
        return {};
    }
}

async function saveConfig(config: VoiceTreeConfig): Promise<void> {
    const configPath: string = getConfigPath();
    try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('[saveConfig] FAILED to save config:', error);
        throw error;  // Propagate error so callers know save failed
    }
}

// Save last watched directory to config
async function saveLastDirectory(directoryPath: string): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.lastDirectory = directoryPath;
    await saveConfig(config);
}

// Get vault config for a specific directory
async function getVaultConfigForDirectory(directoryPath: string): Promise<VaultConfig | undefined> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.vaultConfig?.[directoryPath];
}

// Save vault config for a specific directory
async function saveVaultConfigForDirectory(directoryPath: string, vaultConfig: VaultConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.vaultConfig ??= {};
    config.vaultConfig[directoryPath] = vaultConfig;
    await saveConfig(config);
}

/**
 * Resolve the full vault path allowlist for a project.
 *
 * If saved vault config exists, it is authoritative - use it directly.
 * This ensures user removals persist across reloads.
 *
 * If no saved config, build default allowlist from:
 * 1. Primary vault path (watchedDirectory + suffix)
 * 2. Global default patterns from settings (e.g., "openspec")
 */
async function resolveAllowlistForProject(
    watchedDir: string,
    primaryVaultPath: string
): Promise<{ allowlist: readonly string[]; writePath: string }> {
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // If saved config exists, use it as authoritative source
    // This ensures user removals persist across reloads
    if (savedVaultConfig?.allowlist && savedVaultConfig.allowlist.length > 0) {
        // Filter to paths that still exist on disk
        const allowlist: string[] = [];
        for (const savedPath of savedVaultConfig.allowlist) {
            try {
                await fs.access(savedPath);
                allowlist.push(savedPath);
            } catch {
                // Saved path no longer exists on disk, skip
            }
        }

        // Ensure we have at least the primary vault path
        if (!allowlist.includes(primaryVaultPath)) {
            allowlist.unshift(primaryVaultPath);
        }

        // Use saved write path if it's still in the allowlist
        const resolvedWritePath: string =
            savedVaultConfig.writePath && allowlist.includes(savedVaultConfig.writePath)
                ? savedVaultConfig.writePath
                : primaryVaultPath;

        return { allowlist, writePath: resolvedWritePath };
    }

    // No saved config - build default allowlist
    const settings: VTSettings = await loadSettings();
    const allowlist: string[] = [primaryVaultPath];

    // Add paths from global default patterns (if folders exist)
    const patterns: readonly string[] = settings.defaultAllowlistPatterns ?? [];
    for (const pattern of patterns) {
        const patternPath: string = path.join(watchedDir, pattern);
        try {
            await fs.access(patternPath);
            if (!allowlist.includes(patternPath)) {
                allowlist.push(patternPath);
            }
        } catch {
            // Pattern folder doesn't exist, skip
        }
    }

    return { allowlist, writePath: primaryVaultPath };
}

export async function loadFolder(watchedFolderPath: FilePath): Promise<{ success: boolean }>  {
    // TODO: Save current graph positions before switching folders (writeAllPositionsSync)
    // The watchedFolderPath is both the project folder and the primary vault path (no suffix indirection)

    console.log('[loadFolder] Starting for path:', watchedFolderPath);

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available');
        return { success: false };
    }

    // Update watchedDirectory FIRST
    watchedDirectory = watchedFolderPath;

    // Close old watcher before attempting to load new folder
    if (watcher) {
        await watcher.close();
        watcher = null;
    }

    // Clean up terminals and other resources before switching folders
    if (onFolderSwitchCleanup) {
        console.log('[loadFolder] Running folder switch cleanup (terminals, etc.)');
        onFolderSwitchCleanup();
    }

    // Clear existing graph state in UI-edge before loading new folder
    if (!mainWindow.isDestroyed()) {
        console.log('[loadFolder] Sending graph:clear event to UI-edge');
        mainWindow.webContents.send('graph:clear');
    }

    // The vault path is the watched folder directly (no suffix)
    const vaultPath: string = watchedFolderPath;

    // Ensure vaultPath directory exists (creates if missing)
    await fs.mkdir(vaultPath, { recursive: true });

    // Resolve full allowlist from global patterns + per-project config
    const resolved: { allowlist: readonly string[]; writePath: string } = await resolveAllowlistForProject(watchedFolderPath, vaultPath);

    // Save resolved config to disk (source of truth) so subsequent reads work
    await saveVaultConfigForDirectory(watchedFolderPath, {
        allowlist: resolved.allowlist,
        writePath: resolved.writePath
    });

    // Load graph from disk (IO operation)
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(resolved.allowlist);

    // Handle file limit exceeded
    if (E.isLeft(loadResult)) {
        const fileCount: number = loadResult.left.fileCount;
        console.log('[loadFolder] File limit exceeded:', fileCount, 'files');

        // Show error dialog - user needs to select a smaller folder
        void dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'File Limit Exceeded',
            message: `This folder has ${fileCount} markdown files, which exceeds the limit of 300.\n\nPlease select a folder with fewer files.`,
            buttons: ['OK']
        });
        return { success: false };
    }

    let currentGraph: Graph = loadResult.right;
    console.log('[loadFolder] Graph loaded from disk, node count:', Object.keys(currentGraph.nodes).length);

    // If folder is empty, create a starter node using the template from settings
    if (Object.keys(currentGraph.nodes).length === 0) {
        console.log('[loadFolder] Empty folder detected, creating starter node');
        currentGraph = await createStarterNode(vaultPath);
    }

    // Update graph store
    setGraph(currentGraph);

    // let backend know, call /load-directory non blocking
    notifyTextToTreeServerOfDirectory(vaultPath);

    // Broadcast initial graph to UI-edge (different event from incremental updates)
    const graphDelta : GraphDelta = mapNewGraphToDelta(currentGraph)
    console.log('[loadFolder] Created graph delta, length:', graphDelta.length);

    // Initial load: apply to memory and broadcast to UI
    applyGraphDeltaToMemState(graphDelta)
    broadcastGraphDeltaToUI(graphDelta)
    console.log('[loadFolder] Graph delta broadcast to UI-edge');

    // Setup file watcher - watch all paths in allowlist, use watchedFolderPath as base for node IDs
    await setupWatcher(resolved.allowlist, watchedFolderPath);
    console.log('[loadFolder] File watcher setup complete for', resolved.allowlist.length, 'vault paths');

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    mainWindow.webContents.send('watching-started', {
        directory: watchedDirectory,
        timestamp: new Date().toISOString()
    });

    return { success: true };
}

/**
 * Read file with retry logic for transient file system issues
 * Retries with exponential backoff if file read fails
 * @param filePath - Absolute path to file
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delay - Initial delay in ms between retries (default: 100)
 * @returns Promise that resolves to file content
 */
async function readFileWithRetry(filePath: string, maxRetries = 3, delay = 100): Promise<string> {
    const attemptRead: (attempt: number) => Promise<string> = (attempt: number): Promise<string> => {
        return fs.readFile(filePath, 'utf8')
            .catch((error: unknown) => {
                if (attempt === maxRetries) {
                    return Promise.reject(error);
                }
                // Wait before retry with exponential backoff
                return new Promise<string>(resolve => {
                    setTimeout(() => {
                        resolve(attemptRead(attempt + 1));
                    }, delay * attempt);
                });
            });
    };

    return attemptRead(1);
}

async function setupWatcher(vaultPaths: readonly FilePath[], watchedDir: FilePath): Promise<void> {
    // Note: watcher is already closed in loadFolder before this is called

    // vaultPaths contains all paths in the allowlist (e.g., primary vault + openspec)
    // watchedDir is {loaded_dir} (base for node IDs)

    // Create new watcher - chokidar supports array of paths natively
    watcher = chokidar.watch([...vaultPaths], {
        ignored: [
            // Only watch .md files (directories must pass through for traversal)
            (filePath: string, stats?: Stats) => {
                // If stats available, use it to detect directories
                if (stats?.isDirectory()) {
                    return false;
                }
                // If stats unavailable and no extension, assume it's a directory
                if (!stats && !path.extname(filePath)) {
                    return false;
                }
                return !filePath.endsWith('.md');
            },
        ],
        persistent: true,
        ignoreInitial: true, // Skip initial scan (we already loaded the graph)
        followSymlinks: false,
        depth: 99,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 50
        },
        usePolling: false
    });

    // Setup event handlers for file changes
    setupWatcherListeners(watchedDir);
}

function setupWatcherListeners(watchedDir: FilePath): void {
    if (!watcher) return;

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) return;

    // File added
    watcher.on('add', (filePath: string) => {
        void readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Added'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                // Pass watchedDir so node IDs are relative to watched directory
                handleFSEventWithStateAndUISides(fsUpdate, watchedDir, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file add ${filePath}:`, error);
            });
    });

    // File changed
    watcher.on('change', (filePath: string) => {
        void readFileWithRetry(filePath)
            .then(content => {
                const fsUpdate: FSUpdate = {
                    absolutePath: filePath,
                    content: content,
                    eventType: 'Changed'
                };

                // Handle FS event: compute delta, update state, broadcast to UI-edge
                handleFSEventWithStateAndUISides(fsUpdate, watchedDir, mainWindow);
            })
            .catch(error => {
                console.error(`Error handling file change ${filePath}:`, error);
            });
    });

    // File deleted
    watcher.on('unlink', (filePath: string) => {
        const fsDelete: FSDelete = {
            type: 'Delete',
            absolutePath: filePath
        };

        // Handle FS event: compute delta, update state, broadcast to UI-edge
        handleFSEventWithStateAndUISides(fsDelete, watchedDir, mainWindow);
    });

    // Watch error
    watcher.on('error', (error: unknown) => {
        console.error('File watcher error:', error);
    });
}

export function isWatching(): boolean {
    return watcher !== null;
}

export function getWatchedDirectory(): FilePath | null {
    return watchedDirectory;
}

// API functions for file watching operations

export async function startFileWatching(directoryPath?: string): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    console.log('[watchFolder] startFileWatching called, directoryPath:', directoryPath);

    // Get selected directory (either from param or via dialog)
    const getDirectory: () => Promise<string | null> = async (): Promise<string | null> => {
        if (directoryPath) {
            console.log('[watchFolder] Using provided directory path:', directoryPath);
            return directoryPath;
        }

        console.log('[watchFolder] No directory provided, showing dialog...');

        const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Directory to Watch for Markdown Files',
            buttonLabel: 'Open',
            defaultPath: getWatchedDirectory() ?? process.env.HOME ?? '/'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    };

    const selectedDirectory: string | null = await getDirectory();
    console.log('[watchFolder] Selected directory:', selectedDirectory);

    if (!selectedDirectory) {
        console.log('[watchFolder] No directory selected in picker, keeping same');
        return { success: false, error: 'No new directory selected' };
    }

    // FAIL FAST: Validate directory exists before proceeding
    console.log('[watchFolder] Validating directory exists...');
    if (!fsSync.existsSync(selectedDirectory)) {
        const error: string = `Directory does not exist: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    console.log('[watchFolder] Validating path is a directory...');
    if (!fsSync.statSync(selectedDirectory).isDirectory()) {
        const error: string = `Path is not a directory: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    console.log('[watchFolder] Calling loadFolder...');
    await loadFolder(selectedDirectory);
    console.log('[watchFolder] loadFolder completed successfully');
    return { success: true, directory: selectedDirectory };
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    if (watcher) {
        await watcher.close();
        watcher = null;
        watchedDirectory = null;
    }
    return { success: true };
}

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    const status: { isWatching: boolean; directory: string | undefined } = {
        isWatching: isWatching(),
        directory: getWatchedDirectory() ?? undefined
    };
    console.log('Watch status:', status);
    return status;
}

// Vault path functions - watchedDirectory IS the vault path (no suffix indirection)
export function getVaultPath(): O.Option<FilePath> {
    if (!watchedDirectory) return O.none;
    return O.some(watchedDirectory);
}

// For external callers (MCP) - sets the vault path directly
export function setVaultPath(vaultPath: FilePath): void {
    watchedDirectory = vaultPath;
}

export function clearVaultPath(): void {
    watchedDirectory = null;
}

export async function loadPreviousFolder(): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    console.log('[watchFolder] loadPreviousFolder called');
    await initialLoad();
    const watchedDir: string | null = getWatchedDirectory();
    if (watchedDir) {
        console.log('[watchFolder] Successfully loaded previous folder:', watchedDir);
        return { success: true, directory: watchedDir };
    } else {
        console.log('[watchFolder] No previous folder found to load');
        return { success: false, error: 'No previous folder found' };
    }
}

/**
 * Creates a starter node when opening an empty folder.
 * Uses the emptyFolderTemplate from settings, with {{DATE}} placeholder replaced.
 *
 * @param vaultPath - The vault path where the node file will be created
 * @returns Graph containing the new starter node
 */
async function createStarterNode(vaultPath: string): Promise<Graph> {
    const settings: VTSettings = await loadSettings();
    const template: string = settings.emptyFolderTemplate ?? '# ';

    // Format date: "Tuesday, 23 December"
    const now: Date = new Date();
    const dateStr: string = now.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    });

    // Replace {{DATE}} placeholder with formatted date
    const content: string = template.replace(/\{\{DATE\}\}/g, dateStr);

    // Generate node ID with day-based folder: {dayAbbrev}/{timestamp}{randomChars}.md
    const dayAbbrev: string = now.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const timestamp: string = Date.now().toString();
    const randomChars: string = Array.from({length: 3}, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.charAt(
            Math.floor(Math.random() * 52)
        )
    ).join('');

    const fileName: string = `${timestamp}${randomChars}.md`;
    const relativePath: string = `${dayAbbrev}/${fileName}`;

    // Node ID is the absolute path (consistent with loadGraphFromDisk)
    const absolutePath: string = path.join(vaultPath, relativePath);
    const nodeId: string = absolutePath;

    // Create the node
    const newNode: GraphNode = {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
    };

    const graph: Graph = createGraph({ [nodeId]: newNode });

    // Write the file to disk
    const dirPath: string = path.dirname(absolutePath);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf-8');

    console.log('[createStarterNode] Created starter node:', nodeId);

    return graph;
}
