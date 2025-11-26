import type {BrowserWindow} from "electron";

// The main application window reference
let mainWindow: BrowserWindow | null = null;

// Getter/setter for controlled access to main window
export const getMainWindow: () => BrowserWindow | null = (): BrowserWindow | null => {
    return mainWindow;
};

export const setMainWindow: (window: BrowserWindow) => void = (window: BrowserWindow): void => {
    mainWindow = window;
};
export let backendPort: number | null = null;
export const setBackendPort: (port: number | null) => void = (port: number | null): void => {
    backendPort = port
}
export const getBackendPort: () => number | null =  (): number | null => backendPort;
