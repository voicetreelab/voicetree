import type {BrowserWindow} from "electron";

// The main application window reference
// eslint-disable-next-line functional/no-let
let mainWindow: BrowserWindow | null = null;

// Getter/setter for controlled access to main window
export const getMainWindow = (): BrowserWindow | null => {
    return mainWindow;
};

export const setMainWindow = (window: BrowserWindow): void => {
    mainWindow = window;
};
