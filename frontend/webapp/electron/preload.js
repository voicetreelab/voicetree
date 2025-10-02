const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File watching controls
  startFileWatching: (directoryPath) => ipcRenderer.invoke('start-file-watching', directoryPath),
  stopFileWatching: () => ipcRenderer.invoke('stop-file-watching'),
  getWatchStatus: () => ipcRenderer.invoke('get-watch-status'),

  // File watching event listeners
  onWatchingStarted: (callback) => {
    ipcRenderer.on('watching-started', (event, data) => callback(data));
  },
  onInitialFilesLoaded: (callback) => {
    ipcRenderer.on('initial-files-loaded', (event, data) => callback(data));
  },
  onFileAdded: (callback) => {
    ipcRenderer.on('file-added', (event, data) => callback(data));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, data) => callback(data));
  },
  onFileDeleted: (callback) => {
    ipcRenderer.on('file-deleted', (event, data) => callback(data));
  },
  onDirectoryAdded: (callback) => {
    ipcRenderer.on('directory-added', (event, data) => callback(data));
  },
  onDirectoryDeleted: (callback) => {
    ipcRenderer.on('directory-deleted', (event, data) => callback(data));
  },
  onInitialScanComplete: (callback) => {
    ipcRenderer.on('initial-scan-complete', (event, data) => callback(data));
  },
  onFileWatchError: (callback) => {
    ipcRenderer.on('file-watch-error', (event, data) => callback(data));
  },
  onFileWatchInfo: (callback) => {
    ipcRenderer.on('file-watch-info', (event, data) => callback(data));
  },
  onFileWatchingStopped: (callback) => {
    ipcRenderer.on('file-watching-stopped', (event, data) => callback(data));
  },

  // Remove event listeners (cleanup)
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // File content management
  saveFileContent: (filePath, content) => ipcRenderer.invoke('save-file-content', filePath, content),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),

  // Terminal API
  terminal: {
    spawn: () => ipcRenderer.invoke('terminal:spawn'),
    write: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    kill: (terminalId) => ipcRenderer.invoke('terminal:kill', terminalId),
    onData: (callback) => {
      ipcRenderer.on('terminal:data', (event, terminalId, data) => callback(terminalId, data));
    },
    onExit: (callback) => {
      ipcRenderer.on('terminal:exit', (event, terminalId, code) => callback(terminalId, code));
    }
  }
});