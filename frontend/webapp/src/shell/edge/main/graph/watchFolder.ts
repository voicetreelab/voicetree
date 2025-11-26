import {loadGraphFromDisk} from "@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk";
import type {FilePath, Graph, GraphDelta, FSDelete} from "@/pure/graph";
import {setGraph, setVaultPath} from "@/shell/edge/main/state/graph-store";
import {app, dialog} from "electron";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import {promises as fs} from "fs";
import fsSync from "fs";
import chokidar, {type FSWatcher} from "chokidar";
import type {FSUpdate} from "@/pure/graph";
import {handleFSEventWithStateAndUISides} from "@/shell/edge/main/graph/readAndDBEventsPath/handleFSEventWithStateAndUISides";
import {mapNewGraphToDelta} from "@/pure/graph";
import {applyGraphDeltaToMemStateAndUI} from "@/shell/edge/main/graph/readAndDBEventsPath/applyGraphDeltaToMemStateAndUI";
import {getMainWindow} from "@/shell/edge/main/state/app-electron-state";
import {notifyTextToTreeServerOfDirectory} from "@/shell/edge/main/graph/readAndDBEventsPath/notifyTextToTreeServerOfDirectory";
import {getOnboardingDirectory} from "@/shell/edge/main/electron/onboarding-setup";

// THIS FUNCTION takes absolutePath
// returns graph
// has side effects of sending to UI-edge
// setting up file watchers
// closing old watchers

let watcher: FSWatcher | null = null;

let watchedDirectory: FilePath | null = null;

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
            const config = JSON.parse(data);
            return O.fromNullable(config.lastDirectory);
        })
        .catch((error) => {
            console.error("getLastDirectory", error);
            // Config file doesn't exist yet (first run) - return None
            return O.none;
        });
}

// Save last watched directory to config
async function saveLastDirectory(directoryPath: string): Promise<void> {
    const configPath: string = getConfigPath();
    const config: { lastDirectory: string; } = { lastDirectory: directoryPath };
    return fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
        .catch((error) => {
            console.error('Failed to save last directory:', error);
        });
}

export async function loadFolder(vaultPath: FilePath): Promise<void>  {
    console.log('[loadFolder] Starting for path:', vaultPath);

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

    // Load graph from disk (IO operation)
    const loadResult: E.Either<import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/shell/edge/main/graph/readAndDBEventsPath/fileLimitEnforce").FileLimitExceededError, Graph> = await loadGraphFromDisk(O.some(vaultPath));

    // Exit early if file limit exceeded
    if (E.isLeft(loadResult)) {
        console.log('[loadFolder] File limit exceeded, not setting up watcher');
        return;
    }

    const currentGraph: Graph = loadResult.right;
    console.log('[loadFolder] Graph loaded from disk, node count:', Object.keys(currentGraph.nodes).length);

    // Update graph store
    setVaultPath(vaultPath);
    setGraph(currentGraph);

    // let backend know, call /load-directory non blocking
    notifyTextToTreeServerOfDirectory(vaultPath);

    // Broadcast initial graph to UI-edge (different event from incremental updates)
    const graphDelta : GraphDelta = mapNewGraphToDelta(currentGraph)
    console.log('[loadFolder] Created graph delta, length:', graphDelta.length);

    applyGraphDeltaToMemStateAndUI(graphDelta, mainWindow)
    console.log('[loadFolder] Graph delta broadcast to UI-edge');

    // Setup file watcher
    await setupWatcher(vaultPath);
    console.log('[loadFolder] File watcher setup complete');

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(vaultPath);

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

    // Set the watched directory
    watchedDirectory = vaultPath;

    // Create new watcher
    watcher = chokidar.watch(vaultPath, {
        ignored: [
            // Only watch .md files (directories must pass through for traversal)
            (filePath: string, stats?: import('fs').Stats) => {
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

    // Notify UI that watching has started
    const mainWindow: Electron.CrossProcessExports.BrowserWindow = getMainWindow()!;
    mainWindow.webContents.send('watching-started', {
        directory: vaultPath,
        timestamp: new Date().toISOString()
    });
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
        console.log('[watchFolder] No directory selected, returning error');
        return { success: false, error: 'No directory selected' };
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
    const status: { isWatching: boolean; directory: string | undefined; } = {
        isWatching: isWatching(),
        directory: getWatchedDirectory() ?? undefined
    };
    console.log('Watch status:', status);
    return status;
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
