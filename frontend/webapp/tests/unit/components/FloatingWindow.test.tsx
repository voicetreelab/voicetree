import React from 'react';
import { render, screen } from '@testing-library/react';
import { FloatingWindow } from '@/components/floating-windows/FloatingWindow';
import { FloatingWindowManagerProvider } from '@/components/floating-windows/context/FloatingWindowManager';
import { vi } from 'vitest';

// Mock react-draggable to make testing easier
vi.mock('react-draggable', () => ({
  default: ({ children, position, defaultPosition, onDrag, onStop }: any) => {
    // Use position for transform if provided, otherwise use defaultPosition
    const pos = position || defaultPosition || { x: 0, y: 0 };
    return (
      <div
        data-testid="draggable-wrapper"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        data-position-x={pos.x}
        data-position-y={pos.y}
      >
        {children}
      </div>
    );
  }
}));

describe('FloatingWindow - Position Updates', () => {
  const defaultProps = {
    id: 'test-window',
    nodeId: 'test-node',
    title: 'Test Window',
    type: 'MarkdownEditor' as const,
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    zIndex: 100,
    content: 'Test content',
    graphAnchor: { x: 50, y: 50 },
    graphOffset: { x: 0, y: 0 }
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FloatingWindowManagerProvider>{children}</FloatingWindowManagerProvider>
  );

  it('should update position when position prop changes (controlled mode)', () => {
    const { rerender } = render(
      <FloatingWindow {...defaultProps} position={{ x: 100, y: 100 }} />,
      { wrapper }
    );

    // Check initial position
    const draggable = screen.getByTestId('draggable-wrapper');
    expect(draggable).toHaveStyle({ transform: 'translate(100px, 100px)' });
    expect(draggable).toHaveAttribute('data-position-x', '100');
    expect(draggable).toHaveAttribute('data-position-y', '100');

    // Update position prop (simulating pan/zoom)
    rerender(
      <FloatingWindow {...defaultProps} position={{ x: 200, y: 250 }} />,
      { wrapper }
    );

    // Position should have updated
    expect(draggable).toHaveStyle({ transform: 'translate(200px, 250px)' });
    expect(draggable).toHaveAttribute('data-position-x', '200');
    expect(draggable).toHaveAttribute('data-position-y', '250');

    // Another update (simulating continuous panning)
    rerender(
      <FloatingWindow {...defaultProps} position={{ x: 350, y: 400 }} />,
      { wrapper }
    );

    // Position should update again
    expect(draggable).toHaveStyle({ transform: 'translate(350px, 400px)' });
    expect(draggable).toHaveAttribute('data-position-x', '350');
    expect(draggable).toHaveAttribute('data-position-y', '400');
  });

  it('should handle rapid position updates during pan/zoom', () => {
    const { rerender } = render(
      <FloatingWindow {...defaultProps} position={{ x: 0, y: 0 }} />,
      { wrapper }
    );

    const draggable = screen.getByTestId('draggable-wrapper');

    // Simulate rapid updates like during smooth panning
    const positions = [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
      { x: 40, y: 40 },
      { x: 50, y: 50 }
    ];

    positions.forEach(pos => {
      rerender(
        <FloatingWindow {...defaultProps} position={pos} />,
        { wrapper }
      );
    });

    // Should have the last position
    expect(draggable).toHaveStyle({ transform: 'translate(50px, 50px)' });
    expect(draggable).toHaveAttribute('data-position-x', '50');
    expect(draggable).toHaveAttribute('data-position-y', '50');
  });

  it('should maintain position relative to graph coordinates during pan', () => {
    const { rerender } = render(
      <FloatingWindow
        {...defaultProps}
        position={{ x: 100, y: 100 }}
        graphAnchor={{ x: 50, y: 50 }}
        graphOffset={{ x: 10, y: 10 }}
      />,
      { wrapper }
    );

    const draggable = screen.getByTestId('draggable-wrapper');

    // Initial position
    expect(draggable).toHaveAttribute('data-position-x', '100');
    expect(draggable).toHaveAttribute('data-position-y', '100');

    // Simulate pan: window should move by same amount
    // If graph pans by 50px right and 30px down, window should move too
    rerender(
      <FloatingWindow
        {...defaultProps}
        position={{ x: 150, y: 130 }}  // Moved by pan amount
        graphAnchor={{ x: 50, y: 50 }}  // Anchor stays same in graph coords
        graphOffset={{ x: 10, y: 10 }}  // Offset stays same
      />,
      { wrapper }
    );

    expect(draggable).toHaveAttribute('data-position-x', '150');
    expect(draggable).toHaveAttribute('data-position-y', '130');
  });
});