import { useState, useEffect, useRef, useCallback } from 'react';
import type { JSX, MouseEvent, RefObject, ChangeEvent, KeyboardEvent } from 'react';
import type { FilePath } from '@/pure/graph';
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
 * Dropdown component for selecting the default write path from allowlisted vault paths.
 * Design: Button shows "{folder-name}", dropdown lists all paths with checkmark on current.
 * Paths are editable inline. Also includes an input field to add additional read vault paths.
 */
export function VaultPathSelector({ watchDirectory }: VaultPathSelectorProps): JSX.Element | null {
    const [isOpen, setIsOpen] = useState(false);
    const [vaultPaths, setVaultPaths] = useState<readonly string[]>([]);
    const [defaultWritePath, setDefaultWritePathState] = useState<string | null>(null);
    const [newVaultPath, setNewVaultPath] = useState<string>('');
    const [addError, setAddError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState<boolean>(false);
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [editedValue, setEditedValue] = useState<string>('');
    const [editError, setEditError] = useState<string | null>(null);
    const dropdownRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

    // Start editing a vault path
    const startEditing: (path: string) => void = (path: string): void => {
        const relativePath: string = watchDirectory && path.startsWith(watchDirectory)
            ? path.slice(watchDirectory.length + 1)
            : path;
        setEditingPath(path);
        setEditedValue(relativePath);
        setEditError(null);
    };

    // Save edited vault path
    const saveEditedPath: () => Promise<void> = async (): Promise<void> => {
        if (!window.electronAPI || !editingPath || !editedValue.trim() || !watchDirectory) return;

        const newAbsPath: string = editedValue.startsWith('/')
            ? editedValue
            : `${watchDirectory}/${editedValue}`;

        // If unchanged, just cancel
        if (newAbsPath === editingPath) {
            setEditingPath(null);
            return;
        }

        try {
            // Add new path first
            const addResult: AddVaultResult = await window.electronAPI.main.addVaultPathToAllowlist(newAbsPath);
            if (!addResult.success) {
                setEditError(addResult.error ?? 'Failed to add new path');
                return;
            }

            // If this was the default write path, update it
            if (editingPath === defaultWritePath) {
                await window.electronAPI.main.setDefaultWritePath(newAbsPath);
            }

            // Remove old path
            await window.electronAPI.main.removeVaultPathFromAllowlist(editingPath);

            setEditingPath(null);
            await refreshVaultPaths();
        } catch (err) {
            const errorMessage: string = err instanceof Error ? err.message : 'Unknown error';
            setEditError(errorMessage);
        }
    };

    const cancelEditing: () => void = (): void => {
        setEditingPath(null);
        setEditError(null);
    };

    const handleEditKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void saveEditedPath();
        } else if (e.key === 'Escape') {
            cancelEditing();
        }
    };

    // Fetch vault paths and default write path
    const refreshVaultPaths: () => Promise<void> = useCallback(async (): Promise<void> => {
        if (!window.electronAPI) return;

        try {
            const paths: readonly FilePath[] = await window.electronAPI.main.getVaultPaths();
            setVaultPaths(paths);

            const defaultPath: O.Option<FilePath> = await window.electronAPI.main.getDefaultWritePath();
            if (O.isSome(defaultPath)) {
                setDefaultWritePathState(defaultPath.value);
            } else {
                setDefaultWritePathState(null);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Failed to fetch vault paths:', err);
        }
    }, []);

    // Refresh on mount and when watchDirectory changes
    useEffect(() => {
        void refreshVaultPaths();
    }, [refreshVaultPaths, watchDirectory]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside: (event: Event) => void = (event: Event): void => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setAddError(null);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Handle selecting a new default write path
    const handleSelectPath: (path: string, e: MouseEvent) => Promise<void> = async (path: string, e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI) return;

        try {
            const result: { success: boolean; error?: string } = await window.electronAPI.main.setDefaultWritePath(path);
            if (result.success) {
                setDefaultWritePathState(path);
            } else {
                console.error('[VaultPathSelector] Failed to set default write path:', result.error);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error setting default write path:', err);
        }
        setIsOpen(false);
    };

    // Handle adding a new vault path
    const handleAddVaultPath: () => Promise<void> = async (): Promise<void> => {
        if (!window.electronAPI || !newVaultPath.trim() || !watchDirectory) return;

        setIsAdding(true);
        setAddError(null);

        try {
            // Resolve relative path to absolute if needed
            const pathToAdd: string = newVaultPath.startsWith('/')
                ? newVaultPath
                : `${watchDirectory}/${newVaultPath}`;

            const result: AddVaultResult = await window.electronAPI.main.addVaultPathToAllowlist(pathToAdd);
            if (result.success) {
                setNewVaultPath('');
                await refreshVaultPaths();
            } else {
                setAddError(result.error ?? 'Failed to add vault path');
            }
        } catch (err) {
            const errorMessage: string = err instanceof Error ? err.message : 'Unknown error';
            setAddError(errorMessage);
            console.error('[VaultPathSelector] Error adding vault path:', err);
        } finally {
            setIsAdding(false);
        }
    };

    const handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void = (e: ChangeEvent<HTMLInputElement>): void => {
        setNewVaultPath(e.target.value);
        setAddError(null);
    };

    const handleInputKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void handleAddVaultPath();
        }
    };

    // Handle removing a vault path from the allowlist
    const handleRemovePath: (path: string, e: MouseEvent) => Promise<void> = async (path: string, e: MouseEvent): Promise<void> => {
        e.stopPropagation();
        if (!window.electronAPI) return;

        try {
            const result: { success: boolean; error?: string } = await window.electronAPI.main.removeVaultPathFromAllowlist(path);
            if (result.success) {
                await refreshVaultPaths();
            } else {
                console.error('[VaultPathSelector] Failed to remove vault path:', result.error);
            }
        } catch (err) {
            console.error('[VaultPathSelector] Error removing vault path:', err);
        }
    };

    // Extract folder name from path for display
    const getFolderName: (fullPath: string) => string = (fullPath: string): string => {
        return fullPath.split(/[/\\]/).pop() ?? fullPath;
    };

    // Get relative path from watchDirectory for display
    // Returns "." for root path (when fullPath === watchDirectory) to avoid empty display
    const getRelativePath: (fullPath: string) => string = (fullPath: string): string => {
        if (!watchDirectory) return fullPath;
        if (fullPath === watchDirectory) return '.';
        if (fullPath.startsWith(watchDirectory)) {
            const relative: string = fullPath.slice(watchDirectory.length);
            return relative.startsWith('/') ? relative.slice(1) : relative;
        }
        return fullPath;
    };

    // Always show if we have at least one vault path (to allow adding more)
    if (vaultPaths.length === 0) {
        return null;
    }

    // When defaultWritePath equals watchDirectory, show "." to avoid duplicating the root name
    // (App.tsx already shows the project root name to the left of VaultPathSelector)
    const isRootPath: boolean = Boolean(defaultWritePath && watchDirectory && defaultWritePath === watchDirectory);
    const currentFolderName: string = defaultWritePath
        ? (isRootPath ? '.' : getFolderName(defaultWritePath))
        : 'Select vault';

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
                title={`Default write path: ${defaultWritePath ?? 'None'}`}
            >
                <span>{currentFolderName}</span>
                <span className="text-[10px] ml-0.5">{isOpen ? '▼' : '▲'}</span>
            </button>

            {/* Dropdown menu */}
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded shadow-lg min-w-[200px] max-w-[400px] z-[1200]">
                    <div className="py-1">
                        <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border">
                            Markdown folders (select write destination)
                        </div>
                        {vaultPaths.map((path: string) => {
                            const isDefault: boolean = path === defaultWritePath;
                            const relativePath: string = getRelativePath(path);
                            const isEditing: boolean = editingPath === path;

                            if (isEditing) {
                                return (
                                    <div key={path} className="px-2 py-1.5">
                                        <div className="flex gap-1">
                                            <input
                                                type="text"
                                                value={editedValue}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setEditedValue(e.target.value)}
                                                onKeyDown={handleEditKeyDown}
                                                autoFocus
                                                className="flex-1 px-2 py-1 text-xs border border-ring rounded focus:outline-none focus:ring-1 focus:ring-ring bg-background text-foreground"
                                            />
                                            <button
                                                onClick={() => void saveEditedPath()}
                                                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                                                title="Save"
                                            >
                                                ✓
                                            </button>
                                            <button
                                                onClick={cancelEditing}
                                                className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-accent"
                                                title="Cancel"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        {editError && (
                                            <div className="mt-1 text-[10px] text-destructive">{editError}</div>
                                        )}
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={path}
                                    className={`w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent flex items-center gap-2 ${
                                        isDefault ? 'bg-primary/10' : ''
                                    }`}
                                    title={path}
                                >
                                    {/* Checkmark selects as write destination */}
                                    <button
                                        onClick={(e) => void handleSelectPath(path, e)}
                                        className="w-4 text-primary hover:bg-primary/20 rounded"
                                        title="Set as write destination"
                                    >
                                        {isDefault ? '✓' : '○'}
                                    </button>
                                    {/* Clicking path text enters edit mode */}
                                    <button
                                        onClick={() => startEditing(path)}
                                        className="flex-1 text-left font-medium truncate hover:text-primary flex items-center gap-1"
                                        title="Click to edit path"
                                    >
                                        <span className="truncate">{relativePath}</span>
                                        <span className="text-muted-foreground">✎</span>
                                    </button>
                                    {/* Remove button - hidden for default write path */}
                                    {!isDefault && (
                                        <button
                                            onClick={(e) => void handleRemovePath(path, e)}
                                            className="w-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                                            title="Remove from allowlist"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            );
                        })}

                        {/* Add vault path section */}
                        <div className="border-t border-border mt-1 pt-1">
                            <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
                                Add read vault
                            </div>
                            <div className="px-2 pb-2">
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        value={newVaultPath}
                                        onChange={handleInputChange}
                                        onKeyDown={handleInputKeyDown}
                                        placeholder="folder or /abs/path"
                                        className="flex-1 px-2 py-1 text-xs border border-input rounded focus:outline-none focus:border-ring bg-background text-foreground"
                                        disabled={isAdding}
                                    />
                                    <button
                                        onClick={() => void handleAddVaultPath()}
                                        disabled={isAdding || !newVaultPath.trim()}
                                        className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                                        title="Add vault path"
                                    >
                                        {isAdding ? '...' : '+'}
                                    </button>
                                </div>
                                {addError && (
                                    <div className="mt-1 text-[10px] text-destructive">
                                        {addError}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VaultPathSelector;
