import {loadGraphFromDisk, scanMarkdownFiles} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import type {FilePath, Graph, GraphDelta, FSDelete, GraphNode, DeleteNode} from "@/pure/graph";
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
import {loadSettings} from "@/shell/edge/main/settings/settings_IO";
import {type VTSettings} from "@/pure/settings/types";

// THIS FUNCTION takes absolutePath
// returns graph
// has side effects of sending to UI-edge
// setting up file watchers
// closing old watchers

export const DEFAULT_VAULT_SUFFIX: string = "";

let watcher: FSWatcher | null = null;

let watchedDirectory: FilePath | null = null;
let currentVaultSuffix: string = DEFAULT_VAULT_SUFFIX;

// Multi-vault state: allowlist of vault paths and the default write path
let vaultPathAllowlist: readonly FilePath[] = [];
let defaultWritePath: FilePath | null = null;

/**
 * Get all vault paths in the allowlist.
 * Returns paths that are being watched for file changes.
 */
export function getVaultPaths(): readonly FilePath[] {
    return vaultPathAllowlist;
}

/**
 * Get the default write path (where new nodes are created).
 * Falls back to the primary vault path if not explicitly set.
 */
export function getDefaultWritePath(): O.Option<FilePath> {
    if (defaultWritePath) {
        return O.some(defaultWritePath);
    }
    // Fallback to primary vault path (backward compatibility)
    return getVaultPath();
}

/**
 * Set the default write path. Must be in the allowlist.
 */
export function setDefaultWritePath(vaultPath: FilePath): { success: boolean; error?: string } {
    if (!vaultPathAllowlist.includes(vaultPath)) {
        return { success: false, error: 'Path must be in the allowlist' };
    }
    defaultWritePath = vaultPath;
    return { success: true };
}

/**
 * Add a vault path to the allowlist.
 * The path must exist on disk.
 * Automatically loads files from the new path into the graph and adds to watcher.
 */
export async function addVaultPathToAllowlist(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    // Check if already in allowlist
    if (vaultPathAllowlist.includes(vaultPath)) {
        return { success: false, error: 'Path already in allowlist' };
    }

    // Verify path exists
    try {
        await fs.access(vaultPath);
    } catch {
        return { success: false, error: 'Path does not exist' };
    }

    vaultPathAllowlist = [...vaultPathAllowlist, vaultPath];

    // Persist to config if we have a watched directory
    if (watchedDirectory && defaultWritePath) {
        await saveVaultConfigForDirectory(watchedDirectory, {
            allowlist: vaultPathAllowlist,
            defaultWritePath: defaultWritePath
        });
    }

    // Load files from the new path into the graph
    if (watchedDirectory) {
        const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();

        // Scan and load files from the new vault path
        const files: readonly string[] = await scanMarkdownFiles(vaultPath);
        for (const relativePath of files) {
            const fullPath: string = path.join(vaultPath, relativePath);
            try {
                const content: string = await fs.readFile(fullPath, 'utf8');
                const fsUpdate: FSUpdate = {
                    absolutePath: fullPath,
                    content,
                    eventType: 'Added'
                };
                // Use the same handler as the watcher for consistency
                if (mainWindow) {
                    handleFSEventWithStateAndUISides(fsUpdate, watchedDirectory, mainWindow);
                }
            } catch (err) {
                console.error(`[addVaultPathToAllowlist] Error reading file ${fullPath}:`, err);
            }
        }

        // Add the new path to the watcher
        if (watcher) {
            watcher.add(vaultPath);
        }
    }

    return { success: true };
}

/**
 * Remove a vault path from the allowlist.
 * Cannot remove the default write path.
 * Immediately removes nodes from that vault from the graph.
 */
export function removeVaultPathFromAllowlist(vaultPath: FilePath): { success: boolean; error?: string } {
    if (!vaultPathAllowlist.includes(vaultPath)) {
        return { success: false, error: 'Path not in allowlist' };
    }

    if (vaultPath === defaultWritePath) {
        return { success: false, error: 'Cannot remove default write path' };
    }

    // Remove nodes from the graph that belong to this vault path
    if (watchedDirectory) {
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
        }
    }

    vaultPathAllowlist = vaultPathAllowlist.filter(p => p !== vaultPath);
    return { success: true };
}

/**
 * Initialize the vault path allowlist with a single path (backward compatibility).
 * Used during loadFolder to set up initial state.
 */
function initializeVaultAllowlist(primaryVaultPath: FilePath): void {
    vaultPathAllowlist = [primaryVaultPath];
    defaultWritePath = primaryVaultPath;
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

// Config structure: { lastDirectory, suffixes, vaultConfig }
// Mutable version for internal use (we mutate before saving)
import type { VaultConfig } from "@/pure/settings/types";

interface VoiceTreeConfig {
    lastDirectory?: string;
    suffixes?: { [folderPath: string]: string };
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
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8').catch((error) => {
        console.error('Failed to save config:', error);
    });
}

// Save last watched directory to config
async function saveLastDirectory(directoryPath: string): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.lastDirectory = directoryPath;
    await saveConfig(config);
}

// Get suffix for a specific directory (returns default if not set)
async function getSuffixForDirectory(directoryPath: string): Promise<string> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.suffixes?.[directoryPath] ?? DEFAULT_VAULT_SUFFIX;
}

// Save suffix for a specific directory
async function saveSuffixForDirectory(directoryPath: string, suffix: string): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.suffixes ??= {};
    config.suffixes[directoryPath] = suffix;
    await saveConfig(config);
}

// Check if directory has an explicitly stored suffix (vs using default)
async function hasStoredSuffix(directoryPath: string): Promise<boolean> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.suffixes?.[directoryPath] !== undefined;
}

// Generate date-based suffix: voicetree-{day}-{month}
function generateDateSuffix(): string {
    const now: Date = new Date();
    return `voicetree-${now.getDate()}-${now.getMonth() + 1}`;
}

// Get vault config for a specific directory
async function getVaultConfigForDirectory(directoryPath: string): Promise<VaultConfig | undefined> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.vaultConfig?.[directoryPath];
}

// Save vault config for a specific directory
// Converts absolute paths to relative for storage (portable config)
async function saveVaultConfigForDirectory(directoryPath: string, vaultConfig: VaultConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.vaultConfig ??= {};

    // Convert absolute paths to relative for storage
    const relativeAllowlist: readonly string[] = vaultConfig.allowlist.map(absPath =>
        path.relative(directoryPath, absPath)
    );
    const relativeDefaultWritePath: string = path.relative(directoryPath, vaultConfig.defaultWritePath);

    config.vaultConfig[directoryPath] = {
        allowlist: relativeAllowlist,
        defaultWritePath: relativeDefaultWritePath
    };
    await saveConfig(config);
}

/**
 * Resolve the full vault path allowlist for a project.
 * Combines:
 * 1. Primary vault path (watchedDirectory + suffix)
 * 2. Global default patterns from settings (e.g., "openspec")
 * 3. Explicit paths from per-project vaultConfig
 */
async function resolveAllowlistForProject(
    watchedDir: string,
    primaryVaultPath: string
): Promise<{ allowlist: readonly string[]; defaultWritePath: string }> {
    const settings: VTSettings = await loadSettings();
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // Start with primary vault path
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

    // Add explicit paths from saved vault config (if they still exist)
    // Saved paths are relative - convert to absolute
    if (savedVaultConfig?.allowlist) {
        for (const savedRelativePath of savedVaultConfig.allowlist) {
            const absolutePath: string = path.resolve(watchedDir, savedRelativePath);
            try {
                await fs.access(absolutePath);
                if (!allowlist.includes(absolutePath)) {
                    allowlist.push(absolutePath);
                }
            } catch {
                // Saved path no longer exists, skip
            }
        }
    }

    // Determine default write path
    // Saved defaultWritePath is relative - convert to absolute
    let resolvedDefaultWritePath: string = primaryVaultPath;
    if (savedVaultConfig?.defaultWritePath) {
        const absoluteDefaultPath: string = path.resolve(watchedDir, savedVaultConfig.defaultWritePath);
        if (allowlist.includes(absoluteDefaultPath)) {
            resolvedDefaultWritePath = absoluteDefaultPath;
        }
    }

    return { allowlist, defaultWritePath: resolvedDefaultWritePath };
}

export async function loadFolder(watchedFolderPath: FilePath, suffixOverride?: string): Promise<{ success: boolean }>  {
    // TODO: Save current graph positions before switching folders (writeAllPositionsSync)
    // IMPORTANT,  watchedFolderPath is the folder the human chooses for proj

    // but we only read and write files to the vaultPAth, which is watchedFolderPath/readWriteDir

    console.log('[loadFolder] Starting for path:', watchedFolderPath);

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available');
        return { success: false };
    }

    // Update watchedDirectory FIRST so suffix setting targets the correct folder
    // even if file limit check fails later
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

    // Get suffix: use override if provided (including empty string), otherwise load from config
    const suffix: string = suffixOverride ?? await getSuffixForDirectory(watchedFolderPath);
    currentVaultSuffix = suffix;

    // If suffix is empty, use the watched folder directly; otherwise append suffix
    const vaultPath: string = suffix ? path.join(watchedFolderPath, suffix) : watchedFolderPath;

    // Ensure vaultPath directory exists (creates if missing)
    await fs.mkdir(vaultPath, { recursive: true });

    // Resolve full allowlist from global patterns + per-project config
    const resolved: { allowlist: readonly string[]; defaultWritePath: string } = await resolveAllowlistForProject(watchedFolderPath, vaultPath);

    // Initialize multi-vault state
    initializeVaultAllowlist(vaultPath);
    // Override with resolved allowlist and default write path
    vaultPathAllowlist = resolved.allowlist;
    defaultWritePath = resolved.defaultWritePath;

    // Load graph from disk (IO operation)
    // Pass all vault paths in allowlist and watchedFolderPath (base for node IDs)
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(vaultPathAllowlist, watchedFolderPath);

    // Handle file limit exceeded
    if (E.isLeft(loadResult)) {
        const fileCount: number = loadResult.left.fileCount;
        console.log('[loadFolder] File limit exceeded:', fileCount, 'files');

        // If no suffix explicitly configured for this folder, auto-create a date-based one
        const hasSuffix: boolean = await hasStoredSuffix(watchedFolderPath);
        if (!hasSuffix) {
            const dateSuffix: string = generateDateSuffix();
            console.log('[loadFolder] Auto-creating suffix:', dateSuffix);

            await saveSuffixForDirectory(watchedFolderPath, dateSuffix);

            // Show info dialog (non-blocking)
            void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'New Workspace Created',
                message: `This folder has ${fileCount} markdown files.\n\nCreated new workspace:\n${watchedFolderPath}/${dateSuffix}`,
                buttons: ['OK']
            });

            // Retry with the new suffix
            return loadFolder(watchedFolderPath, dateSuffix);
        }

        // Has explicit suffix but still too many files - show error dialog
        void dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'File Limit Exceeded',
            message: `This folder has ${fileCount} markdown files, which exceeds the limit of 300.\n\nPlease use a different suffix to create a smaller workspace.`,
            buttons: ['OK']
        });
        return { success: false };
    }

    let currentGraph: Graph = loadResult.right;
    console.log('[loadFolder] Graph loaded from disk, node count:', Object.keys(currentGraph.nodes).length);

    // If folder is empty, create a starter node using the template from settings
    if (Object.keys(currentGraph.nodes).length === 0) {
        console.log('[loadFolder] Empty folder detected, creating starter node');
        currentGraph = await createStarterNode(vaultPath, suffix);
    }

    // Update graph store (vault path is derived from watchedDirectory + currentVaultSuffix)
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
    await setupWatcher(vaultPathAllowlist, watchedFolderPath);
    console.log('[loadFolder] File watcher setup complete for', vaultPathAllowlist.length, 'vault paths');

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);
    // Note: watchedDirectory already set at start of function

    // Notify UI that watching has started
    mainWindow.webContents.send('watching-started', {
        directory: watchedDirectory,  // The user-selected folder, not the vaultPath
        vaultSuffix: currentVaultSuffix,
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

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined; readonly vaultSuffix: string } {
    const status: { isWatching: boolean; directory: string | undefined; vaultSuffix: string } = {
        isWatching: isWatching(),
        directory: getWatchedDirectory() ?? undefined,
        vaultSuffix: currentVaultSuffix
    };
    console.log('Watch status:', status);
    return status;
}

export function getVaultSuffix(): string {
    return currentVaultSuffix;
}

// Vault path functions - single source of truth, derived from watchedDirectory + currentVaultSuffix
export function getVaultPath(): O.Option<FilePath> {
    if (!watchedDirectory) return O.none;
    return O.some(currentVaultSuffix ? path.join(watchedDirectory, currentVaultSuffix) : watchedDirectory);
}

// For external callers (MCP) - sets the full vault path directly by setting directory and clearing suffix
export function setVaultPath(path: FilePath): void {
    watchedDirectory = path;
    currentVaultSuffix = '';
}

export function clearVaultPath(): void {
    watchedDirectory = null;
    currentVaultSuffix = DEFAULT_VAULT_SUFFIX;
}

export async function setVaultSuffix(suffix: string): Promise<{ readonly success: boolean; readonly error?: string }> {
    const dir: FilePath | null = getWatchedDirectory();
    if (!dir) {
        return { success: false, error: 'No directory is being watched' };
    }

    // Validate suffix: can be empty (uses directory directly) or valid folder name
    const trimmedSuffix: string = suffix.trim();
    if (trimmedSuffix.includes('/') || trimmedSuffix.includes('\\')) {
        return { success: false, error: 'Suffix cannot contain path separators' };
    }

    // Skip reload if suffix hasn't changed
    if (trimmedSuffix === currentVaultSuffix) {
        return { success: true };
    }

    // Reload the folder with new suffix - only save if load succeeds
    const loadResult: { success: boolean } = await loadFolder(dir, trimmedSuffix);
    if (loadResult.success) {
        await saveSuffixForDirectory(dir, trimmedSuffix);
        return { success: true };
    }

    return { success: false, error: 'Failed to load folder with new suffix (file limit exceeded)' };
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
 * @param vaultSuffix - The vault suffix for node ID generation
 * @returns Graph containing the new starter node
 */
async function createStarterNode(vaultPath: string, vaultSuffix: string): Promise<Graph> {
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

    // Node ID includes vault suffix if present
    const nodeId: string = vaultSuffix ? `${vaultSuffix}/${relativePath}` : relativePath;

    // Create the node
    const newNode: GraphNode = {
        relativeFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
    };

    const graph: Graph = { nodes: { [nodeId]: newNode } };

    // Write the file to disk
    const absolutePath: string = path.join(vaultPath, relativePath);
    const dirPath: string = path.dirname(absolutePath);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf-8');

    console.log('[createStarterNode] Created starter node:', nodeId);

    return graph;
}
