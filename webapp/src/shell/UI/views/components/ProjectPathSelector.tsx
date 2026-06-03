import { useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { subscribeToProjectPaths, getProjectState } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore';
import type { ProjectPathState } from '@/shell/edge/UI-edge/state/stores/ProjectPathStore';
import { toggleFolderTreeSidebar } from '@/shell/edge/UI-edge/state/stores/FolderTreeStore';
import type {} from '@/shell/hostApi';

/**
 * Simplified toggle button that shows current write folder path name
 * and opens the folder tree sidebar on click.
 * All folder management features have moved to FolderTreeSidebar.
 */
export function ProjectPathSelector(): JSX.Element | null {
    const projectState: ProjectPathState = useSyncExternalStore(subscribeToProjectPaths, getProjectState);
    const { readPaths, writeFolderPath } = projectState;

    if (!writeFolderPath && readPaths.length === 0) {
        return null;
    }

    const currentFolderName: string = writeFolderPath
        ? (writeFolderPath.split(/[/\\]/).pop() ?? writeFolderPath)
        : 'Select project';

    return (
        <button
            onClick={() => toggleFolderTreeSidebar()}
            className="text-muted-foreground px-1.5 py-1 rounded bg-muted hover:bg-accent transition-colors flex items-center gap-1"
            title={`Write Path: ${writeFolderPath ?? 'None'} – Click to toggle file tree`}
        >
            <span>{currentFolderName}</span>
        </button>
    );
}
