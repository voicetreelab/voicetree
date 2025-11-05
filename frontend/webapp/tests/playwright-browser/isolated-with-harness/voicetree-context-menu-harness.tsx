/**
 * Test Harness for VoiceTreeGraphView Context Menu Testing
 *
 * This harness creates a minimal VoiceTreeGraphView instance with:
 * - Mock vault provider
 * - Mock graph store
 * - Context menu enabled
 *
 * Exposes to window:
 * - voiceTreeGraphView: VoiceTreeGraphView instance
 * - cytoscapeInstance: Cytoscape core instance
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceTreeGraphView } from '@/views/VoiceTreeGraphView';
import type { IMarkdownVaultProvider } from '@/providers/IMarkdownVaultProvider';

// Extend window type for test harness
interface TestWindow extends Window {
  voiceTreeGraphView: VoiceTreeGraphView;
  cytoscapeInstance: any;
  mockVaultProvider: IMarkdownVaultProvider;
}

declare const window: TestWindow;

// Mock vault provider for testing
class MockVaultProvider implements IMarkdownVaultProvider {
  private watchDir = '/tmp/test-vault';

  async openDirectory(): Promise<{ success: boolean; directory?: string; error?: string }> {
    return { success: true, directory: this.watchDir };
  }

  async getWatchStatus(): Promise<{ isWatching: boolean; directory?: string }> {
    return { isWatching: true, directory: this.watchDir };
  }

  getWatchDirectory(): string | undefined {
    return this.watchDir;
  }

  async savePositions(
    directory: string,
    positions: Record<string, { x: number; y: number }>
  ): Promise<{ success: boolean; error?: string }> {
    console.log('[MockVaultProvider] savePositions called', directory, positions);
    return { success: true };
  }

  onFileAdded(callback: (event: any) => void): any {
    return { dispose: () => {} };
  }

  onFileChanged(callback: (event: any) => void): any {
    return { dispose: () => {} };
  }

  onFileDeleted(callback: (event: any) => void): any {
    return { dispose: () => {} };
  }

  onBulkFilesAdded(callback: (event: any) => void): any {
    return { dispose: () => {} };
  }

  onWatchingStarted(callback: (event: any) => void): any {
    return { dispose: () => {} };
  }
}

// Mock graph store
const mockGraphStore = {
  getState: () => ({ nodes: {} }),
  subscribe: (callback: (graph: any) => void) => {
    // Return unsubscribe function
    return () => {};
  }
};

// Mock electronAPI BEFORE any components are imported
// This must be set up before VoiceTreeGraphView is created
if (typeof window !== 'undefined') {
  (window as any).electronAPI = {
    graph: {
      getState: async () => ({ nodes: {} }),
      applyGraphDelta: async (delta: any) => {
        console.log('[MockElectronAPI] applyGraphDelta called:', delta);
        return { success: true };
      },
      onStateChanged: (callback: (graph: any) => void) => {
        // Return unsubscribe function
        return () => {};
      }
    },
    deleteFile: async (filePath: string) => {
      console.log('[MockElectronAPI] deleteFile called:', filePath);
      return { success: true };
    }
  };
}

export function VoiceTreeContextMenuHarness() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<VoiceTreeGraphView | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;

    console.log('[VoiceTree Context Menu Harness] Initializing...');

    // Create mock vault provider
    const mockVaultProvider = new MockVaultProvider();

    // Initialize VoiceTreeGraphView
    const view = new VoiceTreeGraphView(
      containerRef.current,
      mockVaultProvider,
      {
        headless: false,
        initialDarkMode: false
      }
    );

    viewRef.current = view;

    // Expose to window for test access
    window.voiceTreeGraphView = view;
    window.mockVaultProvider = mockVaultProvider;

    console.log('[VoiceTree Context Menu Harness] Ready!');
    console.log('Available on window: voiceTreeGraphView, cytoscapeInstance, mockVaultProvider');

    return () => {
      if (viewRef.current) {
        viewRef.current.dispose();
        viewRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#ffffff'
      }}
    />
  );
}

// Mount the harness
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<VoiceTreeContextMenuHarness />);
}
