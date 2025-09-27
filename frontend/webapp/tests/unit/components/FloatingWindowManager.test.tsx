import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { FloatingWindowManagerProvider } from '@/components/floating-windows/context/FloatingWindowManager';
import { useFloatingWindows } from '@/components/floating-windows/hooks/useFloatingWindows';

describe('FloatingWindowManager - Graph Coordinate Support', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FloatingWindowManagerProvider>{children}</FloatingWindowManagerProvider>
  );

  beforeEach(() => {
    // Clear any state between tests
  });

  describe('openWindow function', () => {
    it('should accept and store graphAnchor and graphOffset when provided', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      act(() => {
        result.current.openWindow({
          nodeId: 'node1',
          type: 'MarkdownEditor',
          title: 'Test Window',
          position: { x: 100, y: 100 },
          size: { width: 300, height: 200 },
          graphAnchor: { x: 50, y: 75 },
          graphOffset: { x: 10, y: 15 }
        });
      });

      const window = result.current.windows[0];
      expect(window).toBeDefined();
      expect(window.graphAnchor).toEqual({ x: 50, y: 75 });
      expect(window.graphOffset).toEqual({ x: 10, y: 15 });
    });

    it('should work without graph coordinates (backward compatibility)', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      act(() => {
        result.current.openWindow({
          nodeId: 'node2',
          type: 'MarkdownEditor',
          title: 'Test Window',
          position: { x: 200, y: 200 },
          size: { width: 300, height: 200 }
        });
      });

      const window = result.current.windows[0];
      expect(window).toBeDefined();
      expect(window.graphAnchor).toBeUndefined();
      expect(window.graphOffset).toBeUndefined();
      expect(window.position).toEqual({ x: 200, y: 200 });
    });

    it('should allow graphAnchor without graphOffset (defaults to zero offset)', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      act(() => {
        result.current.openWindow({
          nodeId: 'node3',
          type: 'MarkdownEditor',
          title: 'Test Window',
          position: { x: 300, y: 300 },
          size: { width: 300, height: 200 },
          graphAnchor: { x: 150, y: 175 }
        });
      });

      const window = result.current.windows[0];
      expect(window).toBeDefined();
      expect(window.graphAnchor).toEqual({ x: 150, y: 175 });
      expect(window.graphOffset).toBeUndefined();
    });
  });

  describe('updateWindowGraphOffset function', () => {
    it('should update the graphOffset for a window', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      // First create a window with graph coordinates
      act(() => {
        result.current.openWindow({
          nodeId: 'node4',
          type: 'MarkdownEditor',
          title: 'Test Window',
          position: { x: 400, y: 400 },
          size: { width: 300, height: 200 },
          graphAnchor: { x: 200, y: 225 },
          graphOffset: { x: 0, y: 0 }
        });
      });

      const windowId = result.current.windows[0].id;

      // Update the graph offset (simulating user drag)
      act(() => {
        result.current.updateWindowGraphOffset(windowId, { x: 25, y: 30 });
      });

      const updatedWindow = result.current.windows[0];
      expect(updatedWindow.graphOffset).toEqual({ x: 25, y: 30 });
      expect(updatedWindow.graphAnchor).toEqual({ x: 200, y: 225 }); // Should remain unchanged
    });

    it('should handle updating non-existent window gracefully', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      // Try to update a window that doesn't exist
      act(() => {
        result.current.updateWindowGraphOffset('non-existent-id', { x: 10, y: 10 });
      });

      // Should not throw error, just no-op
      expect(result.current.windows.length).toBe(0);
    });

    it('should only update the specified window when multiple windows exist', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      // Create two windows
      act(() => {
        result.current.openWindow({
          nodeId: 'node5',
          type: 'MarkdownEditor',
          title: 'Window 1',
          position: { x: 100, y: 100 },
          size: { width: 300, height: 200 },
          graphAnchor: { x: 50, y: 50 },
          graphOffset: { x: 0, y: 0 }
        });
      });

      act(() => {
        result.current.openWindow({
          nodeId: 'node6',
          type: 'MarkdownEditor',
          title: 'Window 2',
          position: { x: 200, y: 200 },
          size: { width: 300, height: 200 },
          graphAnchor: { x: 100, y: 100 },
          graphOffset: { x: 5, y: 5 }
        });
      });

      const firstWindowId = result.current.windows[0].id;
      const secondWindowId = result.current.windows[1].id;

      // Verify initial state
      expect(result.current.windows).toHaveLength(2);
      expect(result.current.windows[0].graphOffset).toEqual({ x: 0, y: 0 });
      expect(result.current.windows[1].graphOffset).toEqual({ x: 5, y: 5 });

      // Update only the first window
      act(() => {
        result.current.updateWindowGraphOffset(firstWindowId, { x: 15, y: 20 });
      });

      // Find windows by ID to ensure correct ordering
      const updatedFirstWindow = result.current.windows.find(w => w.id === firstWindowId);
      const updatedSecondWindow = result.current.windows.find(w => w.id === secondWindowId);

      expect(updatedFirstWindow).toBeDefined();
      expect(updatedSecondWindow).toBeDefined();
      expect(updatedFirstWindow?.graphOffset).toEqual({ x: 15, y: 20 });
      expect(updatedSecondWindow?.graphOffset).toEqual({ x: 5, y: 5 }); // Unchanged
    });
  });

  describe('existing functionality preservation', () => {
    it('should maintain all existing window operations', () => {
      const { result } = renderHook(() => useFloatingWindows(), { wrapper });

      // Open a window
      act(() => {
        result.current.openWindow({
          nodeId: 'node7',
          type: 'MarkdownEditor',
          title: 'Test Window',
          position: { x: 100, y: 100 },
          size: { width: 300, height: 200 },
          content: 'Initial content'
        });
      });

      const windowId = result.current.windows[0].id;

      // Test updateWindowContent
      act(() => {
        result.current.updateWindowContent(windowId, 'Updated content');
      });
      expect(result.current.windows[0].content).toBe('Updated content');

      // Test updateWindowPosition
      act(() => {
        result.current.updateWindowPosition(windowId, { x: 150, y: 150 });
      });
      expect(result.current.windows[0].position).toEqual({ x: 150, y: 150 });

      // Test bringToFront
      const initialZIndex = result.current.windows[0].zIndex;
      act(() => {
        result.current.bringToFront(windowId);
      });
      expect(result.current.windows[0].zIndex).toBeGreaterThan(initialZIndex);

      // Test closeWindow
      act(() => {
        result.current.closeWindow(windowId);
      });
      expect(result.current.windows.length).toBe(0);
    });
  });
});