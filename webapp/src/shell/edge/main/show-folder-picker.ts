import { dialog } from 'electron';
import os from 'os';

export interface FolderPickerResult {
    readonly success: boolean;
    readonly path?: string;
    readonly error?: string;
}

/**
 * Shows a folder picker dialog using Electron's native dialog.
 * Used for selecting a project folder to open.
 */
export async function showFolderPicker(): Promise<FolderPickerResult> {
    const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Project Folder',
        buttonLabel: 'Open Project',
        defaultPath: os.homedir(),
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No folder selected' };
    }

    return { success: true, path: result.filePaths[0] };
}
