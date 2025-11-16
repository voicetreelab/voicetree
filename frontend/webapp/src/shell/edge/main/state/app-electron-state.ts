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
// eslint-disable-next-line functional/no-let
export let backendPort: number | null = null;
export const setBackendPort = (port: number | null): void => {
    backendPort = port
}
export const getBackendPort =  (): number | null => backendPort;
