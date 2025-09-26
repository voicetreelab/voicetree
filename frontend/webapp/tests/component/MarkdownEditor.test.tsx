import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownEditor } from '@/components/floating-windows/editors/MarkdownEditor';
import { FloatingWindowManagerProvider } from '@/components/floating-windows/context/FloatingWindowManager';

// Mock functions
const mockOnSave = vi.fn();
const mockCloseWindow = vi.fn();

// Create a test wrapper that provides the context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <FloatingWindowManagerProvider>
      {children}
    </FloatingWindowManagerProvider>
  );
};

beforeEach(() => {
  mockOnSave.mockClear();
  mockCloseWindow.mockClear();
  mockOnSave.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Mock the closeWindow function from the hook
vi.mock('../../src/components/floating-windows/hooks/useFloatingWindows', () => ({
  useFloatingWindows: () => ({
    closeWindow: mockCloseWindow,
    openWindow: vi.fn(),
    windows: [],
    activeWindowId: null,
    setActiveWindow: vi.fn(),
    updateWindow: vi.fn(),
    updateWindowContent: vi.fn(), // Add this to prevent debounce errors
  })
}));

describe('MarkdownEditor Component', () => {
  const defaultProps = {
    content: '# Initial Content',
    onSave: mockOnSave,
    windowId: 'test-window-1'
  };

  test('should receive and display initial content', () => {
    // Test for Phase 1.1 requirement: "Editor receives initial content"
    render(<MarkdownEditor {...defaultProps} content="Hello World" />, { wrapper: TestWrapper });

    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('Hello World');
  });

  test('should allow user to edit and save content', async () => {
    const user = userEvent.setup();
    render(<MarkdownEditor {...defaultProps} />, { wrapper: TestWrapper });

    // Find the editor textarea
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue('# Initial Content');

    // User clears and types new content
    await user.clear(editor);
    await user.type(editor, '# Updated Content\n\nThis is my new text.');

    // Click save button
    const saveButton = screen.getByText('Save');
    await user.click(saveButton);

    // Verify save was called with correct content
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        '# Updated Content\n\nThis is my new text.'
      );
    });

    // Should show "Saved!" message
    await waitFor(() => {
      expect(screen.getByText('Saved!')).toBeInTheDocument();
    });

    // Window should NOT close automatically after save
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  test('should save even when content is unchanged', async () => {
    const user = userEvent.setup();
    render(<MarkdownEditor {...defaultProps} />, { wrapper: TestWrapper });

    // Click save without making changes
    const saveButton = screen.getByText('Save');
    await user.click(saveButton);

    // Component saves even without changes (no dirty state checking)
    expect(mockOnSave).toHaveBeenCalledWith(
      '# Initial Content'
    );

    // Should show "Saved!" message
    await waitFor(() => {
      expect(screen.getByText('Saved!')).toBeInTheDocument();
    });
  });


  test('should show saving state while save is in progress', async () => {
    const user = userEvent.setup();

    // Make save take some time to resolve
    let resolveSave: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = () => resolve();
    });
    mockOnSave.mockReturnValue(savePromise);

    render(<MarkdownEditor {...defaultProps} />, { wrapper: TestWrapper });

    const editor = screen.getByRole('textbox');
    await user.type(editor, ' - edited');

    const saveButton = screen.getByText('Save');
    await user.click(saveButton);

    // Should show "Saving..." state
    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(screen.getByText('Saving...')).toBeDisabled();

    // Resolve the save
    resolveSave!();

    // Should show "Saved!" briefly
    await waitFor(() => {
      expect(screen.getByText('Saved!')).toBeInTheDocument();
    });

    // Window should NOT close automatically
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  test('should handle save errors gracefully', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Make save fail by rejecting the promise
    mockOnSave.mockRejectedValue(new Error('Failed to save'));

    render(<MarkdownEditor {...defaultProps} />, { wrapper: TestWrapper });

    const editor = screen.getByRole('textbox');
    await user.type(editor, ' - will fail');

    const saveButton = screen.getByText('Save');
    await user.click(saveButton);

    // Should show error state briefly
    await waitFor(() => {
      expect(screen.getByText('Error!')).toBeInTheDocument();
    });

    // Should return to normal state after timeout
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Should log error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error saving content:',
      expect.any(Error)
    );

    // Should NOT close window on error
    expect(mockCloseWindow).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});