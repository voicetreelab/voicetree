import { dialog } from 'electron';
import os from 'os';

export interface FolderPickerResult {
    readonly success: boolean;
    readonly path?: string;
    readonly error?: string;
}

export interface FolderPickerOptions {
    /** Starting directory. If undefined, defaults to home directory. */
    readonly defaultPath: string | undefined;
    readonly buttonLabel: string;
    readonly title: string;
}

/**
 * Shows a folder picker dialog using Electron's native dialog.
 */
export async function showFolderPicker(options: FolderPickerOptions): Promise<FolderPickerResult> {
    const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: options.title,
        buttonLabel: options.buttonLabel,
        defaultPath: options.defaultPath ?? os.homedir(),
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No folder selected' };
    }

    return { success: true, path: result.filePaths[0] };
}
