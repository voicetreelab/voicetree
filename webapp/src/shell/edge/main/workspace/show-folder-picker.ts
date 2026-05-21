import { dialog } from 'electron';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createDatedSubfolder } from './project-utils';

/**
 * Creates a new dated project folder inside ~/Voicetree (e.g. ~/Voicetree/voicetree-18-2).
 * Creates the parent ~/Voicetree directory if it doesn't exist.
 */
export async function createNewProject(): Promise<string> {
    const parentDir: string = path.join(os.homedir(), 'Voicetree');
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }
    return createDatedSubfolder(parentDir);
}

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
