import {loadGraphFromDisk} from "@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/loadGraphFromDisk";
import type {FilePath, Graph, GraphDelta, FSDelete} from "@/pure/graph";
import type {FileLimitExceededError} from "@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/fileLimitEnforce";
import {setGraph} from "@/shell/edge/main/state/graph-store";
import {app, dialog} from "electron";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import {promises as fs} from "fs";
import fsSync from "fs";
import chokidar, {type FSWatcher} from "chokidar";
import type {FSUpdate} from "@/pure/graph";
import type {Stats} from "fs";
import {handleFSEventWithStateAndUISides} from "@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/handleFSEventWithStateAndUISides";
import {mapNewGraphToDelta} from "@/pure/graph";
import {applyGraphDeltaToMemStateAndUI} from "@/shell/edge/main/graph/markdownReadWritePaths/applyGraphDeltaToMemStateAndUI";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";
import {notifyTextToTreeServerOfDirectory} from "@/shell/edge/main/graph/markdownReadWritePaths/readAndApplyDBEventsPath/notifyTextToTreeServerOfDirectory";
import {getOnboardingDirectory} from "@/shell/edge/main/electron/onboarding-setup";

// THIS FUNCTION takes absolutePath
// returns graph
// has side effects of sending to UI-edge
// setting up file watchers
// closing old watchers

export const DEFAULT_VAULT_SUFFIX: string = "voicetree";

let watcher: FSWatcher | null = null;

let watchedDirectory: FilePath | null = null;
let currentVaultSuffix: string = DEFAULT_VAULT_SUFFIX;

//todo move this state to src/functional/shell/state/app-electron-state.ts

export async function initialLoad(): Promise<void>  {
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

// Config structure: { lastDirectory: string, suffixes: { [folderPath: string]: string } }
interface VoiceTreeConfig {
    lastDirectory?: string;
    suffixes?: { [folderPath: string]: string };
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

export async function loadFolder(watchedFolderPath: FilePath, suffixOverride?: string): Promise<void>  {
    // IMPORTANT,  watchedFolderPath is the folder the human chooses for proj

    // but we only read and write files to the vaultPAth, which is watchedFolderPath/readWriteDir

    console.log('[loadFolder] Starting for path:', watchedFolderPath);

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available');
        return;
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
    const vaultPath: string = suffix ? `${watchedFolderPath}/${suffix}` : watchedFolderPath;

    // Ensure vaultPath directory exists (creates if missing)
    await fs.mkdir(vaultPath, { recursive: true });

    // Load graph from disk (IO operation)
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(vaultPath));

    // Exit early if file limit exceeded
    if (E.isLeft(loadResult)) {
        console.log('[loadFolder] File limit exceeded, not setting up watcher');
        return;
    }

    const currentGraph: Graph = loadResult.right;
    console.log('[loadFolder] Graph loaded from disk, node count:', Object.keys(currentGraph.nodes).length);

    // Update graph store (vault path is derived from watchedDirectory + currentVaultSuffix)
    setGraph(currentGraph);

    // let backend know, call /load-directory non blocking
    notifyTextToTreeServerOfDirectory(vaultPath);

    // Broadcast initial graph to UI-edge (different event from incremental updates)
    const graphDelta : GraphDelta = mapNewGraphToDelta(currentGraph)
    console.log('[loadFolder] Created graph delta, length:', graphDelta.length);

    applyGraphDeltaToMemStateAndUI(graphDelta)
    console.log('[loadFolder] Graph delta broadcast to UI-edge');

    // Setup file watcher
    await setupWatcher(vaultPath);
    console.log('[loadFolder] File watcher setup complete');

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);
    watchedDirectory = watchedFolderPath;

    // Notify UI that watching has started
    mainWindow.webContents.send('watching-started', {
        directory: watchedDirectory,  // The user-selected folder, not the vaultPath
        vaultSuffix: currentVaultSuffix,
        timestamp: new Date().toISOString()
    });
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

async function setupWatcher(vaultPath: FilePath): Promise<void> {
    // Close old watcher if it exists
    if (watcher) {
        await watcher.close();
        watcher = null;
    }

    // remember vaultPAth isi {loaded_dir}/voicetree
    //

    // Create new watcher
    watcher = chokidar.watch(vaultPath, {
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
    setupWatcherListeners(vaultPath);


}

function setupWatcherListeners(vaultPath: FilePath): void {
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
                handleFSEventWithStateAndUISides(fsUpdate, vaultPath, mainWindow);
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
                handleFSEventWithStateAndUISides(fsUpdate, vaultPath, mainWindow);
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
        handleFSEventWithStateAndUISides(fsDelete, vaultPath, mainWindow);
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
            buttonLabel: 'Watch Directory',
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
    return O.some(currentVaultSuffix ? `${watchedDirectory}/${currentVaultSuffix}` : watchedDirectory);
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

    // Save the new suffix for this directory
    await saveSuffixForDirectory(dir, trimmedSuffix);

    // Reload the folder with new suffix
    await loadFolder(dir, trimmedSuffix);

    return { success: true };
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
