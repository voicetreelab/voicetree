import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { subscribeToVaultPaths, getVaultState } from '@/shell/edge/UI-edge/state/VaultPathStore';
import type { VaultPathState } from '@/shell/edge/UI-edge/state/VaultPathStore';
import { toggleFolderTreeSidebar } from '@/shell/edge/UI-edge/state/FolderTreeStore';
import type {} from '@/shell/electron';

/**
 * Simplified toggle button that shows current write folder name
 * and opens the folder tree sidebar on click.
 * All folder management features have moved to FolderTreeSidebar.
 */
export function VaultPathSelector(): JSX.Element | null {
    const vaultState: VaultPathState = useSyncExternalStore(subscribeToVaultPaths, getVaultState);
    const { readPaths, writePath } = vaultState;

    if (readPaths.length === 0) {
        return null;
    }

    const currentFolderName: string = writePath
        ? (writePath.split(/[/\\]/).pop() ?? writePath)
        : 'Select vault';

    return (
        <button
            onClick={() => toggleFolderTreeSidebar()}
            className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
            title={`Write Path: ${writePath ?? 'None'} – Click to toggle file tree`}
        >
            <span>{currentFolderName}</span>
        </button>
    );
}

export default VaultPathSelector;
