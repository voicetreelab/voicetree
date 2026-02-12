import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import type { JSX, MouseEvent, RefObject, ChangeEvent, KeyboardEvent } from 'react';
import type { AvailableFolderItem } from '@/pure/folders/types';
import { toDisplayPath, toAbsolutePath } from '@/pure/folders';
import { subscribeToVaultPaths, getVaultState } from '@/shell/edge/UI-edge/state/VaultPathStore';
import type { VaultPathState } from '@/shell/edge/UI-edge/state/VaultPathStore';
import type {} from '@/shell/electron';

interface VaultPathSelectorProps {
    watchDirectory: string | undefined;
}

interface AddVaultResult {
    success: boolean;
    error?: string;
}

/**
 * Dropdown component for folder management with four sections:
 * 1. WRITING TO - current write folder with reset button
 * 2. ALSO READING - loaded read folders with remove/promote actions
 * 3. STARRED - starred folders that appear across all projects
 * 4. ADD FOLDER - search and add new folders
 */
export function VaultPathSelector({ watchDirectory }: VaultPathSelectorProps): JSX.Element | null {
    // Push-based state from main process via VaultPathStore
    const vaultState: VaultPathState = useSyncExternalStore(subscribeToVaultPaths, getVaultState);
    const { readPaths, writePath, starredFolders } = vaultState;

    // Local UI state
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [availableFolders, setAvailableFolders] = useState<readonly AvailableFolderItem[]>([]);
    const [homeDir, setHomeDir] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const dropdownRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
    const searchInputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);

    // Fetch available folders based on search query
    const fetchAvailableFolders: (query: string) => Promise<void> = useCallback(async (query: string): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const folders: readonly AvailableFolderItem[] = await window.electronAPI.main.getAvailableFoldersForSelector(query);
            setAvailableFolders(folders);
        } catch (err) {
            console.error('[VaultPathSelector] Failed to fetch available folders:', err);
        }
    }, []);

    // Derive home directory from app support path on mount
    useEffect(() => {
        if (!window.electronAPI) return;
        void (async (): Promise<void> => {
            const appSupportPath: string = await window.electronAPI!.main.getAppSupportPath();
            const homeMatch: RegExpMatchArray | null = appSupportPath.match(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/);
            if (homeMatch) setHomeDir(homeMatch[1]);
        })();
    }, []);

    // Fetch available folders when dropdown opens or search changes
    useEffect(() => {
        if (isOpen) {
            void fetchAvailableFolders(searchQuery);
        }
    }, [isOpen, searchQuery, fetchAvailableFolders]);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
                searchInputRef.current?.focus();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside: (event: Event) => void = (event: Event): void => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchQuery('');
                setError(null);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Handle reset write path to project root
    const handleResetToRoot: (e: MouseEvent) => Promise<void> = async (e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI || !watchDirectory) return;

        try {
            const result: AddVaultResult = await window.electronAPI.main.setWritePath(watchDirectory);
            if (!result.success) {
                setError(result.error ?? 'Failed to reset write path');
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error resetting write path:', err);
        }
    };

    // Handle promoting a read folder to write folder
    const handlePromoteToWrite: (path: string, e: MouseEvent) => Promise<void> = async (path: string, e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI) return;

        try {
            const result: AddVaultResult = await window.electronAPI.main.setWritePath(path);
            if (result.success) {
                await fetchAvailableFolders(searchQuery);
            } else {
                setError(result.error ?? 'Failed to set write path');
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error setting write path:', err);
        }
    };

    // Handle removing a read folder
    const handleRemoveReadFolder: (path: string, e: MouseEvent) => Promise<void> = async (path: string, e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI) return;

        try {
            const result: AddVaultResult = await window.electronAPI.main.removeReadPath(path);
            if (result.success) {
                await fetchAvailableFolders(searchQuery);
            } else {
                setError(result.error ?? 'Failed to remove folder');
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error removing folder:', err);
        }
    };

    // Handle adding folder as write destination
    const handleSetAsWrite: (path: string) => Promise<void> = async (path: string): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            // First add to vault paths if not already
            await window.electronAPI.main.addReadPath(path);
            // Then set as write path
            const result: AddVaultResult = await window.electronAPI.main.setWritePath(path);
            if (result.success) {
                await fetchAvailableFolders(searchQuery);
            } else {
                setError(result.error ?? 'Failed to set write path');
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error setting write path:', err);
        }
    };

    // Handle adding folder as read source
    const handleAddAsRead: (path: string) => Promise<void> = async (path: string): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const result: AddVaultResult = await window.electronAPI.main.addReadPath(path);
            if (result.success) {
                await fetchAvailableFolders(searchQuery);
            } else {
                setError(result.error ?? 'Failed to add read folder');
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error adding read folder:', err);
        }
    };

    // Handle browse external folder
    const handleBrowseExternal: () => Promise<void> = async (): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const result: { success: boolean; path?: string } = await window.electronAPI.main.showFolderPicker({
                defaultPath: watchDirectory,
                buttonLabel: 'Add Subfolder',
                title: 'Select Subfolder to Add',
            });
            if (result.success && result.path) {
                await handleAddAsRead(result.path);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error browsing for folder:', err);
        }
    };

    // Handle toggling star on a folder
    const handleToggleStar: (path: string, e: MouseEvent) => Promise<void> = async (path: string, e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI) return;

        try {
            if (starredFolders.includes(path)) {
                await window.electronAPI.main.removeStarredFolder(path);
            } else {
                await window.electronAPI.main.addStarredFolder(path);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error toggling star:', err);
        }
    };

    const handleSearchChange: (e: ChangeEvent<HTMLInputElement>) => void = (e: ChangeEvent<HTMLInputElement>): void => {
        setSearchQuery(e.target.value);
        setError(null);
    };

    const handleSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            setSearchQuery('');
        }
    };

    // Get display path relative to watchDirectory using pure toDisplayPath
    // Prefixes with "./" to indicate relativity to project root
    const getDisplayPath: (fullPath: string) => string = (fullPath: string): string => {
        if (!watchDirectory) return fullPath;
        const displayPath: string = toDisplayPath(toAbsolutePath(watchDirectory), toAbsolutePath(fullPath));
        // Use "./" prefix to show these are relative paths
        return displayPath === '.' ? './' : './' + displayPath;
    };

    // Get display path with ~/prefix for external paths under home dir
    const getSmartDisplayPath: (fullPath: string) => string = (fullPath: string): string => {
        if (watchDirectory && (fullPath === watchDirectory || fullPath.startsWith(watchDirectory + '/'))) {
            return getDisplayPath(fullPath);
        }
        if (homeDir && fullPath.startsWith(homeDir + '/')) {
            return '~' + fullPath.slice(homeDir.length);
        }
        return fullPath;
    };

    // Get folder name from path for button display
    const getFolderName: (fullPath: string) => string = (fullPath: string): string => {
        if (!watchDirectory) return fullPath.split(/[/\\]/).pop() ?? fullPath;
        if (fullPath === watchDirectory) return '.';
        return fullPath.split(/[/\\]/).pop() ?? fullPath;
    };

    // Filter read folders to exclude the write path
    const readOnlyFolders: string[] = readPaths.filter((path): path is string => path !== writePath);

    // Compute which starred folders are loaded vs unloaded
    const loadedPathSet: Set<string> = new Set(readPaths);
    const unloadedStarredFolders: readonly string[] = starredFolders.filter((p: string) => !loadedPathSet.has(p));

    // Always show if we have at least one path
    if (readPaths.length === 0) {
        return null;
    }

    const currentFolderName: string = writePath ? getFolderName(writePath) : 'Select vault';
    const projectName: string = watchDirectory?.split(/[/\\]/).pop() ?? 'project root';

    // Star toggle button for folder rows
    const renderStarButton: (path: string) => JSX.Element = (path: string): JSX.Element => {
        const isStarred: boolean = starredFolders.includes(path);
        return (
            <button
                onClick={(e: MouseEvent<HTMLButtonElement>) => void handleToggleStar(path, e)}
                className={`px-1 py-0.5 text-sm rounded transition-colors ${
                    isStarred
                        ? 'text-amber-400 hover:text-amber-300'
                        : 'text-muted-foreground/30 hover:text-amber-400/60'
                }`}
                title={isStarred ? 'Unstar folder' : 'Star folder'}
            >
                {isStarred ? '\u2605' : '\u2606'}
            </button>
        );
    };

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
                title={`Write Path: ${writePath ?? 'None'}`}
            >
                <span>{currentFolderName}</span>
                <span className="text-[10px] ml-0.5">{isOpen ? '\u25BC' : '\u25B2'}</span>
            </button>

            {/* Dropdown menu */}
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded shadow-lg min-w-[280px] max-w-[400px] z-[1200]">
                    <div className="py-1">
                        {/* Project root header */}
                        <div className="px-3 py-1.5 text-[11px] text-muted-foreground/70 border-b border-border flex items-center gap-1.5">
                            <span className="opacity-60">{'\uD83D\uDCC1'}</span>
                            <span className="truncate font-medium" title={watchDirectory}>
                                {projectName}/
                            </span>
                        </div>

                        {/* Error display */}
                        {error && (
                            <div className="px-3 py-1 text-[10px] text-destructive bg-destructive/10 border-b border-border">
                                {error}
                            </div>
                        )}

                        {/* WRITING TO section */}
                        <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border">
                            Writing to
                        </div>
                        <div className="group px-3 py-1.5 flex items-center justify-between hover:bg-accent/50">
                            <div className="flex items-center gap-2">
                                <span className="text-primary">{'\u25CF'}</span>
                                <span className="text-xs font-medium truncate max-w-[200px]" title={writePath ?? undefined}>
                                    {writePath ? getSmartDisplayPath(writePath) : 'None'}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                {writePath && renderStarButton(writePath)}
                                {writePath && writePath !== watchDirectory && (
                                    <button
                                        onClick={(e: MouseEvent<HTMLButtonElement>) => void handleResetToRoot(e)}
                                        className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                                        title={`Reset to ${projectName}`}
                                    >
                                        {'\u2212'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* ALSO READING section - only show if there are read-only folders */}
                        {readOnlyFolders.length > 0 && (
                            <>
                                <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide border-t border-b border-border mt-1">
                                    Also reading
                                </div>
                                {readOnlyFolders.map((path: string) => (
                                    <div
                                        key={path}
                                        className="group px-3 py-1.5 flex items-center justify-between hover:bg-accent/50"
                                    >
                                        <button
                                            onClick={(e: MouseEvent<HTMLButtonElement>) => void handlePromoteToWrite(path, e)}
                                            className="flex items-center gap-2 text-left flex-1 min-w-0"
                                            title={`Click to set as write destination: ${path}`}
                                        >
                                            <span className="text-muted-foreground">{'\u25CB'}</span>
                                            <span className="text-xs truncate hover:text-primary">
                                                {getSmartDisplayPath(path)}
                                            </span>
                                        </button>
                                        <div className="flex items-center gap-1">
                                            {renderStarButton(path)}
                                            <button
                                                onClick={(e: MouseEvent<HTMLButtonElement>) => void handleRemoveReadFolder(path, e)}
                                                className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded ml-1"
                                                title="Remove from read list"
                                            >
                                                {'\u2212'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}

                        {/* STARRED section */}
                        <div className="border-t border-border mt-1">
                            <div className="px-3 py-1 text-[10px] text-amber-400 uppercase tracking-wide border-b border-border flex items-center gap-1.5">
                                <span>{'\u2605'} Starred</span>
                                {starredFolders.length > 0 && (
                                    <span className="text-[9px] bg-amber-400/15 text-amber-400 px-1 rounded">
                                        {starredFolders.length}
                                    </span>
                                )}
                            </div>
                            <div className="border-l-2 border-amber-400/20 ml-2 max-h-[120px] overflow-y-auto">
                                {starredFolders.length === 0 ? (
                                    <div className="px-3 py-2 text-[11px] text-muted-foreground/50 italic">
                                        Star folders to see them here
                                    </div>
                                ) : (
                                    <>
                                        {/* Loaded starred folders */}
                                        {starredFolders.filter((p: string) => loadedPathSet.has(p)).map((path: string) => (
                                            <div
                                                key={path}
                                                className="group px-3 py-1 flex items-center justify-between hover:bg-accent/50"
                                            >
                                                <span className="text-xs truncate flex-1 min-w-0 text-muted-foreground" title={path}>
                                                    {getSmartDisplayPath(path)}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[9px] text-emerald-400 ml-2 flex-shrink-0">
                                                        {'\u2713'} loaded
                                                    </span>
                                                    <button
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => void handleToggleStar(path, e)}
                                                        className="px-1 py-0.5 text-sm text-amber-400 hover:text-amber-300 rounded transition-colors"
                                                        title="Unstar folder"
                                                    >
                                                        {'\u2605'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {/* Unloaded starred folders with Write/Read buttons */}
                                        {unloadedStarredFolders.map((path: string) => (
                                            <div
                                                key={path}
                                                className="group px-3 py-1 flex items-center justify-between hover:bg-accent/50"
                                            >
                                                <span className="text-xs truncate flex-1 min-w-0 text-muted-foreground/70 group-hover:text-foreground transition-colors" title={path}>
                                                    {getSmartDisplayPath(path)}
                                                </span>
                                                <div className="flex gap-1 flex-shrink-0 items-center ml-2">
                                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                        <button
                                                            onClick={() => void handleSetAsWrite(path)}
                                                            className="px-1.5 py-0.5 text-[10px] text-primary-foreground bg-primary/80 hover:bg-primary rounded-sm"
                                                            title="Set as write destination"
                                                        >
                                                            Write
                                                        </button>
                                                        <button
                                                            onClick={() => void handleAddAsRead(path)}
                                                            className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-sm border border-dashed border-muted-foreground/30"
                                                            title="Add as read folder"
                                                        >
                                                            Read
                                                        </button>
                                                    </div>
                                                    <button
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => void handleToggleStar(path, e)}
                                                        className="px-1 py-0.5 text-sm text-amber-400 hover:text-amber-300 rounded transition-colors"
                                                        title="Unstar folder"
                                                    >
                                                        {'\u2605'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ADD FOLDER section - styled as search/autocomplete panel */}
                        <div className="border-t border-border mt-1 bg-muted/30">
                            {/* Search input - prominent focal point */}
                            <div className="px-2 pt-2 pb-1.5">
                                <div className="relative">
                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-[10px]">
                                        +
                                    </span>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={searchQuery}
                                        onChange={handleSearchChange}
                                        onKeyDown={handleSearchKeyDown}
                                        placeholder="Add folder..."
                                        className="w-full pl-5 pr-2 py-1.5 text-xs border border-dashed border-muted-foreground/30 rounded-sm focus:outline-none focus:border-primary/50 focus:bg-background bg-background/50 text-foreground placeholder:text-muted-foreground/50 placeholder:italic"
                                    />
                                </div>
                            </div>

                            {/* Available folders list - suggestion style */}
                            <div className="max-h-[150px] overflow-y-auto">
                                {/* Create folder option - show when no exact match exists AND not already loaded */}
                                {searchQuery.trim() &&
                                    watchDirectory &&
                                    !searchQuery.startsWith('.') &&
                                    !availableFolders.some((f: AvailableFolderItem) => f.displayPath === searchQuery.trim()) &&
                                    !readPaths.some((p: string) => {
                                        const displayPath: string = toDisplayPath(toAbsolutePath(watchDirectory), toAbsolutePath(p));
                                        return displayPath === searchQuery.trim();
                                    }) && (
                                    <button
                                        onClick={() => void handleSetAsWrite(searchQuery.trim().startsWith('/') ? searchQuery.trim() : watchDirectory + '/' + searchQuery.trim())}
                                        className="group w-[calc(100%-1rem)] mx-2 mb-1 px-2 py-1.5 flex items-center gap-2 rounded-sm border border-dashed border-primary/40 hover:border-primary hover:bg-primary/10 transition-colors text-left"
                                        title="Create folder and set as write destination"
                                    >
                                        <span className="text-primary/70 text-[10px]">+</span>
                                        <span className="text-xs text-muted-foreground/70 group-hover:text-foreground transition-colors">
                                            Create <span className="font-medium text-foreground">{searchQuery.trim()}/</span>
                                        </span>
                                    </button>
                                )}
                                {availableFolders.map((folder: AvailableFolderItem, index: number) => (
                                    <div
                                        key={folder.absolutePath}
                                        className="group mx-2 mb-1 px-2 py-1 flex items-center justify-between gap-1 rounded-sm border-l-2 border-dashed border-muted-foreground/20 hover:border-primary/40 hover:bg-background/80 transition-colors"
                                        style={{
                                            animationDelay: `${index * 20}ms`,
                                        }}
                                    >
                                        <span
                                            className="text-xs truncate flex-1 min-w-0 text-muted-foreground/70 group-hover:text-foreground transition-colors"
                                            title={folder.absolutePath}
                                        >
                                            {folder.displayPath === '.' ? './' : './' + folder.displayPath}
                                        </span>
                                        <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => void handleSetAsWrite(folder.absolutePath)}
                                                className="px-1.5 py-0.5 text-[10px] text-primary-foreground bg-primary/80 hover:bg-primary rounded-sm"
                                                title="Set as write destination"
                                            >
                                                Write
                                            </button>
                                            <button
                                                onClick={() => void handleAddAsRead(folder.absolutePath)}
                                                className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-sm border border-dashed border-muted-foreground/30"
                                                title="Add as read folder"
                                            >
                                                Read
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {availableFolders.length === 0 && !searchQuery && (
                                    <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center italic">
                                        Type to search folders...
                                    </div>
                                )}
                            </div>

                            {/* Browse external folder */}
                            <div className="px-2 py-1.5 border-t border-dashed border-muted-foreground/15">
                                <button
                                    onClick={() => void handleBrowseExternal()}
                                    className="w-full px-2 py-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-background/50 rounded-sm transition-colors"
                                >
                                    Browse external...
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VaultPathSelector;
