/**
 * Stub module for Electron/Node dependencies in web-only builds.
 * Used as a resolve alias in vite.web.config.ts to prevent bundling
 * node-pty, electron, chokidar, etc.
 */
export default {};
export const ipcRenderer: undefined = undefined;
export const app: undefined = undefined;
