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
 * Design: Button shows "📝 {folder-name}", dropdown lists all paths with checkmark on current.
 * Also includes an input field to add additional read vault paths.
 */
export function VaultPathSelector({ watchDirectory }: VaultPathSelectorProps): JSX.Element | null {
    const [isOpen, setIsOpen] = useState(false);
    const [vaultPaths, setVaultPaths] = useState<readonly string[]>([]);
    const [defaultWritePath, setDefaultWritePathState] = useState<string | null>(null);
    const [newVaultPath, setNewVaultPath] = useState<string>('');
    const [addError, setAddError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState<boolean>(false);
    const dropdownRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

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

    // Extract folder name from path for display
    const getFolderName: (fullPath: string) => string = (fullPath: string): string => {
        return fullPath.split(/[/\\]/).pop() ?? fullPath;
    };

    // Get relative path from watchDirectory for display
    const getRelativePath: (fullPath: string) => string = (fullPath: string): string => {
        if (!watchDirectory) return fullPath;
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

    const currentFolderName: string = defaultWritePath ? getFolderName(defaultWritePath) : 'Select vault';

    return (
        <div ref={dropdownRef} className="relative">
            {/* Trigger button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="text-gray-600 px-1.5 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors flex items-center gap-1"
                title={`Default write path: ${defaultWritePath ?? 'None'}`}
            >
                <span>📝</span>
                <span>{currentFolderName}</span>
                <span className="text-[10px] ml-0.5">{isOpen ? '▲' : '▼'}</span>
            </button>

            {/* Dropdown menu */}
            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-300 rounded shadow-lg min-w-[200px] max-w-[400px] z-[1200]">
                    <div className="py-1">
                        <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wide border-b border-gray-200">
                            Write destination
                        </div>
                        {vaultPaths.map((path: string) => {
                            const isDefault: boolean = path === defaultWritePath;
                            const relativePath: string = getRelativePath(path);
                            const folderName: string = getFolderName(path);

                            return (
                                <button
                                    key={path}
                                    onClick={(e) => void handleSelectPath(path, e)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 flex items-center gap-2 ${
                                        isDefault ? 'bg-blue-50' : ''
                                    }`}
                                    title={path}
                                >
                                    <span className="w-4 text-blue-600">
                                        {isDefault ? '✓' : ''}
                                    </span>
                                    <span className="font-medium">{folderName}</span>
                                    {relativePath !== folderName && (
                                        <span className="text-gray-400 truncate">
                                            ({relativePath})
                                        </span>
                                    )}
                                </button>
                            );
                        })}

                        {/* Add vault path section */}
                        <div className="border-t border-gray-200 mt-1 pt-1">
                            <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wide">
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
                                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                                        disabled={isAdding}
                                    />
                                    <button
                                        onClick={() => void handleAddVaultPath()}
                                        disabled={isAdding || !newVaultPath.trim()}
                                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                        title="Add vault path"
                                    >
                                        {isAdding ? '...' : '+'}
                                    </button>
                                </div>
                                {addError && (
                                    <div className="mt-1 text-[10px] text-red-500">
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
