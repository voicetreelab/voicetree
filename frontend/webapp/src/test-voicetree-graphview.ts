import './index.css';
import './graph-core/styles/floating-windows.css';

/**
 * Test harness for VoiceTreeGraphView
 *
 * This file creates an isolated test environment for the vanilla VoiceTreeGraphView class
 * It mocks window.electronAPI and provides test controls to simulate file events
 */

import { VoiceTreeGraphView } from './views/VoiceTreeGraphView';
import type { FileEvent } from './views/IVoiceTreeGraphView';

// Mock electronAPI for testing
interface MockElectronAPI {
  onWatchingStarted?: (callback: (data: { directory: string }) => void) => void;
  onInitialFilesLoaded: (callback: (data: { files: FileEvent[]; directory: string }) => void) => void;
  onFileAdded: (callback: (data: FileEvent) => void) => void;
  onFileChanged: (callback: (data: FileEvent) => void) => void;
  onFileDeleted: (callback: (data: { fullPath: string }) => void) => void;
  onFileWatchingStopped: (callback: () => void) => void;
  removeAllListeners: (channel: string) => void;
  openFolder?: () => Promise<{ success: boolean; directory?: string; error?: string }>;
  stopWatching?: () => Promise<void>;

  // Test markdown_parsing - not part of real API
  _simulateFileAdded?: (file: FileEvent) => void;
  _simulateFileChanged?: (file: FileEvent) => void;
  _simulateFileDeleted?: (fullPath: string) => void;
  _simulateBulkLoad?: (files: FileEvent[]) => void;
}

class MockElectronAPIImpl implements MockElectronAPI {
  private listeners = {
    watchingStarted: new Set<(data: { directory: string }) => void>(),
    initialFilesLoaded: new Set<(data: { files: FileEvent[]; directory: string }) => void>(),
    fileAdded: new Set<(data: FileEvent) => void>(),
    fileChanged: new Set<(data: FileEvent) => void>(),
    fileDeleted: new Set<(data: { fullPath: string }) => void>(),
    watchingStopped: new Set<() => void>()
  };

  onWatchingStarted(callback: (data: { directory: string }) => void): void {
    this.listeners.watchingStarted.add(callback);
  }

  onInitialFilesLoaded(callback: (data: { files: FileEvent[]; directory: string }) => void): void {
    this.listeners.initialFilesLoaded.add(callback);
  }

  onFileAdded(callback: (data: FileEvent) => void): void {
    this.listeners.fileAdded.add(callback);
  }

  onFileChanged(callback: (data: FileEvent) => void): void {
    this.listeners.fileChanged.add(callback);
  }

  onFileDeleted(callback: (data: { fullPath: string }) => void): void {
    this.listeners.fileDeleted.add(callback);
  }

  onFileWatchingStopped(callback: () => void): void {
    this.listeners.watchingStopped.add(callback);
  }

  removeAllListeners(channel: string): void {
    const channelMap: Record<string, keyof typeof this.listeners> = {
      'watching-started': 'watchingStarted',
      'initial-files-loaded': 'initialFilesLoaded',
      'file-added': 'fileAdded',
      'file-changed': 'fileChanged',
      'file-deleted': 'fileDeleted',
      'file-watching-stopped': 'watchingStopped'
    };

    const listenerKey = channelMap[channel];
    if (listenerKey) {
      this.listeners[listenerKey].clear();
    }
  }

  // Test helper methods
  _simulateFileAdded(file: FileEvent): void {
    console.log('[MockAPI] Simulating file added:', file.fullPath);
    console.log('[MockAPI] Number of fileAdded listeners:', this.listeners.fileAdded.size);
    this.listeners.fileAdded.forEach(cb => {
      console.log('[MockAPI] Calling fileAdded callback...');
      cb(file);
    });
  }

  _simulateFileChanged(file: FileEvent): void {
    console.log('[MockAPI] Simulating file changed:', file.fullPath);
    console.log('[MockAPI] Number of fileChanged listeners:', this.listeners.fileChanged.size);
    this.listeners.fileChanged.forEach(cb => {
      console.log('[MockAPI] Calling fileChanged callback...');
      cb(file);
    });
  }

  _simulateFileDeleted(fullPath: string): void {
    console.log('[MockAPI] Simulating file deleted:', fullPath);
    console.log('[MockAPI] Number of fileDeleted listeners:', this.listeners.fileDeleted.size);
    this.listeners.fileDeleted.forEach(cb => {
      console.log('[MockAPI] Calling fileDeleted callback...');
      cb({ fullPath });
    });
  }

  _simulateBulkLoad(files: FileEvent[]): void {
    console.log('[MockAPI] Simulating bulk load:', files.length, 'files');
    console.log('[MockAPI] Number of initialFilesLoaded listeners:', this.listeners.initialFilesLoaded.size);
    this.listeners.initialFilesLoaded.forEach(cb => {
      console.log('[MockAPI] Calling initialFilesLoaded callback...');
      cb({
        files,
        directory: '/test/directory'
      });
    });
  }

  async openFolder(): Promise<{ success: boolean; directory?: string; error?: string }> {
    return { success: true, directory: '/test/directory' };
  }

  async stopWatching(): Promise<void> {
    this.listeners.watchingStopped.forEach(cb => cb());
  }
}

// Initialize mock API
const mockAPI = new MockElectronAPIImpl();
(window as any).electronAPI = mockAPI;

// Test file data
let testFileCounter = 0;

function createTestFile(content?: string): FileEvent {
  testFileCounter++;
  const filename = `test-node-${testFileCounter}.md`;
  const fullPath = `/test/directory/${filename}`;

  return {
    fullPath,
    relativePath: filename,
    content: content || `---
node_id: ${testFileCounter}
title: Test Node ${testFileCounter}
---

## Test Node ${testFileCounter}

This is a test node created at ${new Date().toISOString()}.

### Links
${testFileCounter > 1 ? `- Parent: [[test-node-${testFileCounter - 1}]]` : ''}
`
  };
}

// Sample bulk load files
function createBulkLoadFiles(): FileEvent[] {
  return [
    {
      fullPath: '/test/directory/root-concept.md',
      relativePath: 'root-concept.md',
      content: `---
node_id: 1
title: Root Concept
---

## Root Concept

The main concept of our knowledge graph.
`
    },
    {
      fullPath: '/test/directory/child-a.md',
      relativePath: 'child-a.md',
      content: `---
node_id: 2
title: Child A
---

## Child A

A child concept related to [[root-concept]].
`
    },
    {
      fullPath: '/test/directory/child-b.md',
      relativePath: 'child-b.md',
      content: `---
node_id: 3
title: Child B
---

## Child B

Another child concept related to [[root-concept]].
`
    },
    {
      fullPath: '/test/directory/grandchild.md',
      relativePath: 'grandchild.md',
      content: `---
node_id: 4
title: Grandchild
---

## Grandchild

A deeper concept related to [[child-a]].
`
    }
  ];
}

async function initializeTest() {
  console.log('=== Initializing VoiceTreeGraphView Test ===');

  try {
    // Get container
    const container = document.getElementById('graph-container');
    if (!container) {
      throw new Error('Graph container not found');
    }

    // Create VoiceTreeGraphView instance
    console.log('Creating VoiceTreeGraphView instance...');
    const graphView = new VoiceTreeGraphView(container, {
      initialDarkMode: false
    });

    console.log('✓ VoiceTreeGraphView created successfully');

    // Expose to window for testing
    (window as any).voiceTreeGraphView = graphView;
    (window as any).cytoscapeInstance = graphView['cy']?.getCore();

    // Get UI elements
    const btnAddFile = document.getElementById('btn-add-file') as HTMLButtonElement;
    const btnChangeFile = document.getElementById('btn-change-file') as HTMLButtonElement;
    const btnDeleteFile = document.getElementById('btn-delete-file') as HTMLButtonElement;
    const btnBulkLoad = document.getElementById('btn-bulk-load') as HTMLButtonElement;
    const btnToggleDark = document.getElementById('btn-toggle-dark') as HTMLButtonElement;
    const statusEl = document.getElementById('status') as HTMLSpanElement;

    let addedFiles: FileEvent[] = [];
    let isDarkMode = false;

    // Wire up test controls
    btnAddFile.addEventListener('click', () => {
      const file = createTestFile();
      addedFiles.push(file);
      mockAPI._simulateFileAdded(file);
      statusEl.textContent = `Added file: ${file.relativePath || file.fullPath}`;
    });

    btnChangeFile.addEventListener('click', () => {
      if (addedFiles.length === 0) {
        statusEl.textContent = 'No files to change! Add a file first.';
        return;
      }
      const file = addedFiles[addedFiles.length - 1];
      const changedFile = {
        ...file,
        content: file.content + `\n\n### Updated\nContent changed at ${new Date().toISOString()}`
      };
      addedFiles[addedFiles.length - 1] = changedFile;
      mockAPI._simulateFileChanged(changedFile);
      statusEl.textContent = `Changed file: ${file.relativePath || file.fullPath}`;
    });

    btnDeleteFile.addEventListener('click', () => {
      if (addedFiles.length === 0) {
        statusEl.textContent = 'No files to delete! Add a file first.';
        return;
      }
      const file = addedFiles.pop()!;
      mockAPI._simulateFileDeleted(file.fullPath);
      statusEl.textContent = `Deleted file: ${file.relativePath || file.fullPath}`;
    });

    btnBulkLoad.addEventListener('click', () => {
      const bulkFiles = createBulkLoadFiles();
      addedFiles = bulkFiles;
      mockAPI._simulateBulkLoad(bulkFiles);
      statusEl.textContent = `Bulk loaded ${bulkFiles.length} files`;
    });

    btnToggleDark.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      if (graphView['toggleDarkMode']) {
        graphView['toggleDarkMode']();
      }
      statusEl.textContent = `Dark mode: ${isDarkMode ? 'ON' : 'OFF'}`;
    });

    console.log('✓ Test controls wired up');
    console.log('=== Test harness ready! ===');
    console.log('Available test controls:');
    console.log('  - Add Test File: Creates a new node');
    console.log('  - Change File: Modifies the last added file');
    console.log('  - Delete File: Removes the last added file');
    console.log('  - Bulk Load Files: Loads 4 interconnected test files');
    console.log('  - Toggle Dark Mode: Switches between light/dark themes');
    console.log('');
    console.log('Available in window: voiceTreeGraphView, cytoscapeInstance');

  } catch (error) {
    console.error('Failed to initialize test harness:', error);

    const container = document.getElementById('graph-container');
    if (container) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      container.innerHTML = `
        <div class="error">
          <h2>Test Harness Initialization Failed</h2>
          <p>Error: ${errorMessage}</p>
          <p style="font-size: 12px; opacity: 0.7;">Check console for details</p>
        </div>
      `;
    }
  }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTest);
} else {
  initializeTest();
}
