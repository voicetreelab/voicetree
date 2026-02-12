import { useState, useEffect, useRef, useCallback } from 'react';
import type { JSX, MouseEvent, RefObject, ChangeEvent, KeyboardEvent } from 'react';
import type { FilePath } from '@/pure/graph';
import type { AvailableFolderItem } from '@/pure/folders/types';
import { toDisplayPath, toAbsolutePath } from '@/pure/folders';
import * as O from 'fp-ts/lib/Option.js';
import type {} from '@/shell/electron';

interface VaultPathSelectorProps {
    watchDirectory: string | undefined;
}

interface AddVaultResult {
    success: boolean;
    error?: string;
}

/**
 * Dropdown component for folder management with three sections:
 * 1. WRITING TO - current write folder with reset button
 * 2. ALSO READING - loaded read folders with remove/promote actions
 * 3. ADD FOLDER - search and add new folders
 */
export function VaultPathSelector({ watchDirectory }: VaultPathSelectorProps): JSX.Element | null {
    const [isOpen, setIsOpen] = useState(false);
    const [readPaths, setReadPaths] = useState<readonly string[]>([]);
    const [writePath, setWritePathState] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [availableFolders, setAvailableFolders] = useState<readonly AvailableFolderItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const dropdownRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
    const searchInputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);

    // Fetch read paths and writePath
    const refreshPaths: () => Promise<void> = useCallback(async (): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const paths: readonly FilePath[] = await window.electronAPI.main.getVaultPaths();
            setReadPaths(paths);

            const currentWritePath: O.Option<FilePath> = await window.electronAPI.main.getWritePath();
            if (O.isSome(currentWritePath)) {
                setWritePathState(currentWritePath.value);
            } else {
                setWritePathState(null);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Failed to fetch paths:', err);
        }
    }, []);

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

    // Refresh on mount and when watchDirectory changes
    useEffect(() => {
        void refreshPaths();
    }, [refreshPaths, watchDirectory]);

    // Fetch available folders when dropdown opens or search changes
    useEffect(() => {
        if (isOpen) {
            void fetchAvailableFolders(searchQuery);
        }
    }, [isOpen, searchQuery, fetchAvailableFolders]);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            // Small delay to ensure the dropdown is rendered
            const timer = setTimeout(() => {
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
            if (result.success) {
                await refreshPaths();
            } else {
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
                await refreshPaths();
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
                await refreshPaths();
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
                await refreshPaths();
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
                await refreshPaths();
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
            const result = await window.electronAPI.main.showFolderPicker({
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

    const handleSearchChange: (e: ChangeEvent<HTMLInputElement>) => void = (e: ChangeEvent<HTMLInputElement>): void => {
        setSearchQuery(e.target.value);
        setError(null);
    };

    const handleSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            setSearchQuery('');
        } else if (e.key === 'Enter' && searchQuery.trim() && watchDirectory) {
            e.preventDefault();
            const trimmed: string = searchQuery.trim();
            const exactMatch: AvailableFolderItem | undefined = availableFolders.find(
                (f: AvailableFolderItem) => f.displayPath === trimmed
            );
            if (exactMatch) {
                void handleSetAsWrite(exactMatch.absolutePath);
            } else if (
                !trimmed.startsWith('.') &&
                !readPaths.some((p: string) => {
                    const displayPath: string = toDisplayPath(toAbsolutePath(watchDirectory), toAbsolutePath(p));
                    return displayPath === trimmed;
                })
            ) {
                void handleSetAsWrite(watchDirectory + '/' + trimmed);
            }
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

    // Get folder name from path for button display
    const getFolderName: (fullPath: string) => string = (fullPath: string): string => {
        if (!watchDirectory) return fullPath.split(/[/\\]/).pop() ?? fullPath;
        if (fullPath === watchDirectory) return '.';
        return fullPath.split(/[/\\]/).pop() ?? fullPath;
    };

    // Filter read folders to exclude the write path
    const readOnlyFolders: string[] = readPaths.filter((path): path is string => path !== writePath);

    // Always show if we have at least one path
    if (readPaths.length === 0) {
        return null;
    }

    const currentFolderName: string = writePath ? getFolderName(writePath) : 'Select vault';
    const projectName: string = watchDirectory?.split(/[/\\]/).pop() ?? 'project root';

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
                title={`Write Path: ${writePath ?? 'None'}`}
            >
                <span>{currentFolderName}</span>
                <span className="text-[10px] ml-0.5">{isOpen ? '▼' : '▲'}</span>
            </button>

            {/* Dropdown menu */}
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded shadow-lg min-w-[280px] max-w-[400px] z-[1200]">
                    <div className="py-1">
                        {/* Project root header */}
                        <div className="px-3 py-1.5 text-[11px] text-muted-foreground/70 border-b border-border flex items-center gap-1.5">
                            <span className="opacity-60">📁</span>
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
                        <div className="px-3 py-1.5 flex items-center justify-between hover:bg-accent/50">
                            <div className="flex items-center gap-2">
                                <span className="text-primary">●</span>
                                <span className="text-xs font-medium truncate max-w-[200px]" title={writePath ?? undefined}>
                                    {writePath ? getDisplayPath(writePath) : 'None'}
                                </span>
                            </div>
                            {writePath && writePath !== watchDirectory && (
                                <button
                                    onClick={handleResetToRoot}
                                    className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                                    title={`Reset to ${projectName}`}
                                >
                                    −
                                </button>
                            )}
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
                                        className="px-3 py-1.5 flex items-center justify-between hover:bg-accent/50"
                                    >
                                        <button
                                            onClick={(e) => void handlePromoteToWrite(path, e)}
                                            className="flex items-center gap-2 text-left flex-1 min-w-0"
                                            title={`Click to set as write destination: ${path}`}
                                        >
                                            <span className="text-muted-foreground">○</span>
                                            <span className="text-xs truncate hover:text-primary">
                                                {getDisplayPath(path)}
                                            </span>
                                        </button>
                                        <button
                                            onClick={(e) => void handleRemoveReadFolder(path, e)}
                                            className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded ml-2"
                                            title="Remove from read list"
                                        >
                                            −
                                        </button>
                                    </div>
                                ))}
                            </>
                        )}

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
                                        onClick={() => void handleSetAsWrite(watchDirectory + '/' + searchQuery.trim())}
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
