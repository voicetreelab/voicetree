import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpeedDialMenu from '@/components/speed-dial-menu';

describe('SpeedDialMenu', () => {
  const mockProps = {
    onToggleDarkMode: vi.fn(),
    onClearHistory: vi.fn(),
    isDarkMode: false
  };

  it('renders collapsed state by default', () => {
    render(<SpeedDialMenu {...mockProps} />);

    // Should show container
    const container = screen.getByTestId('speed-dial-container');
    expect(container).toBeInTheDocument();

    // Items should be collapsed
    const items = screen.getAllByTestId(/speed-dial-item/);
    items.forEach(item => {
      expect(item).toHaveClass('speed-dial-item');
    });
  });

  it('expands on hover', () => {
    render(<SpeedDialMenu {...mockProps} />);

    const container = screen.getByTestId('speed-dial-container');

    // Hover over container
    fireEvent.mouseEnter(container);

    // Check that items exist and labels are in the DOM
    const items = screen.getAllByTestId(/speed-dial-item/);
    expect(items).toHaveLength(5);

    // Labels should be in the DOM (CSS controls visibility)
    expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('collapses on mouse leave', () => {
    render(<SpeedDialMenu {...mockProps} />);

    const container = screen.getByTestId('speed-dial-container');

    // Hover and then leave
    fireEvent.mouseEnter(container);
    fireEvent.mouseLeave(container);

    // Items should still exist
    const items = screen.getAllByTestId(/speed-dial-item/);
    expect(items).toHaveLength(5);
  });

  it('handles dark mode toggle click', () => {
    render(<SpeedDialMenu {...mockProps} />);

    const container = screen.getByTestId('speed-dial-container');
    fireEvent.mouseEnter(container);

    const darkModeButton = screen.getByTestId('speed-dial-item-0');
    fireEvent.click(darkModeButton);

    expect(mockProps.onToggleDarkMode).toHaveBeenCalledTimes(1);
  });

  it('handles clear history click', () => {
    render(<SpeedDialMenu {...mockProps} />);

    const container = screen.getByTestId('speed-dial-container');
    fireEvent.mouseEnter(container);

    const clearButton = screen.getByTestId('speed-dial-item-3');
    fireEvent.click(clearButton);

    expect(mockProps.onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('shows light mode icon when dark mode is active', () => {
    render(<SpeedDialMenu {...mockProps} isDarkMode={true} />);

    const container = screen.getByTestId('speed-dial-container');
    fireEvent.mouseEnter(container);

    expect(screen.getByText('Light Mode')).toBeInTheDocument();
  });
});