import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VoiceTreeLayout from "@/components/voicetree-layout";

// Constants from VoiceTreeLayout
const MAX_HISTORY_ENTRIES = 50;
const HISTORY_STORAGE_KEY = 'voicetree-history';

// Mock the fetch API
global.fetch = vi.fn();

// Mock the useVoiceTreeClient hook
vi.mock("@/hooks/useVoiceTreeClient", () => ({
  default: vi.fn(() => ({
    state: "Idle",
    finalTokens: [],
    nonFinalTokens: [],
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    error: null,
  })),
}));

// Mock API key
vi.mock("@/utils/get-api-key", () => ({
  default: () => "test-api-key",
}));

describe("VoiceTree Integration Tests", () => {
  beforeEach(() => {
    // Clear localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }

    // Reset fetch mock
    (global.fetch as any).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe.skip("Text Input Flow", () => {
    it("completes full text input flow: type → submit → add to history", async () => {
      const user = userEvent.setup();

      // Mock successful API response
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      render(<VoiceTreeLayout />);

      // Find input field
      const input = screen.getByPlaceholderText(/type or speak your message/i);
      expect(input).toBeInTheDocument();

      // Type text
      await user.type(input, "Test message");
      expect(input).toHaveValue("Test message");

      // Submit with Enter key
      await user.keyboard("{Enter}");

      // Verify API call
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "http://localhost:8000/send-text",
          expect.objectContaining({
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: "Test message" }),
          })
        );
      });

      // Check that input was cleared
      expect(input).toHaveValue("");

      // Verify history entry appears
      await waitFor(() => {
        const historyText = screen.getByText("Test message");
        expect(historyText).toBeInTheDocument();
      });

      // Verify buffer length updates
      const bufferDisplay = screen.getByText("100");
      expect(bufferDisplay).toBeInTheDocument();
    });

    it("handles multiple text submissions", async () => {
      const user = userEvent.setup();

      // Mock multiple successful API responses
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ buffer_length: 100 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ buffer_length: 200 }),
        });

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);
      const sendButton = screen.getByRole("button", { name: /send/i });

      // First submission
      await user.type(input, "First message");
      await user.click(sendButton);

      // Second submission
      await user.type(input, "Second message");
      await user.click(sendButton);

      // Verify both history entries appear
      await waitFor(() => {
        expect(screen.getByText("First message")).toBeInTheDocument();
        expect(screen.getByText("Second message")).toBeInTheDocument();
      });

      // Verify buffer updated to latest value
      const bufferDisplay = screen.getByText("200");
      expect(bufferDisplay).toBeInTheDocument();
    });
  });

  describe.skip("Server Offline Scenario", () => {
    it("handles server offline gracefully", async () => {
      const user = userEvent.setup();

      // Mock network error
      (global.fetch as any).mockRejectedValueOnce(
        new Error("Network error")
      );

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Submit text
      await user.type(input, "Offline test");
      await user.keyboard("{Enter}");

      // Message should still be added to history
      await waitFor(() => {
        expect(screen.getByText("Offline test")).toBeInTheDocument();
      });

      // Should show offline warning
      await waitFor(() => {
        const offlineWarning = screen.getByText(/offline/i);
        expect(offlineWarning).toBeInTheDocument();
      });
    });

    it("recovers when server comes back online", async () => {
      const user = userEvent.setup();

      // First request fails
      (global.fetch as any).mockRejectedValueOnce(
        new Error("Network error")
      );

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Submit while offline
      await user.type(input, "Offline message");
      await user.keyboard("{Enter}");

      // Wait for offline indicator
      await waitFor(() => {
        expect(screen.getByText(/offline/i)).toBeInTheDocument();
      });

      // Server comes back online
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ buffer_length: 150 }),
      });

      // Submit while online
      await user.type(input, "Online message");
      await user.keyboard("{Enter}");

      // Offline indicator should disappear
      await waitFor(() => {
        expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
      });

      // Both messages should be in history
      expect(screen.getByText("Offline message")).toBeInTheDocument();
      expect(screen.getByText("Online message")).toBeInTheDocument();
    });
  });

  describe.skip("History Management", () => {
    it("persists history to localStorage", async () => {
      const user = userEvent.setup();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      const { unmount } = render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Add entry to history
      await user.type(input, "Persistent message");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Persistent message")).toBeInTheDocument();
      });

      // Unmount and remount component
      unmount();
      render(<VoiceTreeLayout />);

      // History should be restored
      await waitFor(() => {
        expect(screen.getByText("Persistent message")).toBeInTheDocument();
      });
    });

    it("clears history when clear button is clicked", async () => {
      const user = userEvent.setup();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Add entry to history
      await user.type(input, "Message to clear");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Message to clear")).toBeInTheDocument();
      });

      // Click clear button
      const clearButton = screen.getByTitle(/clear history/i);
      await user.click(clearButton);

      // History should be empty
      await waitFor(() => {
        expect(screen.queryByText("Message to clear")).not.toBeInTheDocument();
        expect(screen.getByText(/start speaking or typing/i)).toBeInTheDocument();
      });

      // localStorage should be cleared
      expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
    });

    it("limits history to maximum entries", async () => {
      const user = userEvent.setup();

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Add many entries (more than MAX_HISTORY_ENTRIES)
      for (let i = 0; i < 55; i++) {
        await user.clear(input);
        await user.type(input, `Message ${i}`);
        await user.keyboard("{Enter}");
      }

      // Should only show last 50 messages
      await waitFor(() => {
        // First 5 messages should not be present
        expect(screen.queryByText("Message 0")).not.toBeInTheDocument();
        expect(screen.queryByText("Message 4")).not.toBeInTheDocument();

        // Last messages should be present
        expect(screen.getByText("Message 54")).toBeInTheDocument();
        expect(screen.getByText("Message 50")).toBeInTheDocument();
      });
    });
  });

  describe.skip("UI Interactions", () => {
    it("disables input while processing", async () => {
      const user = userEvent.setup();

      // Mock slow API response
      (global.fetch as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => ({ buffer_length: 100 }),
        }), 100))
      );

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);
      const sendButton = screen.getByRole("button", { name: /send/i });

      // Submit text
      await user.type(input, "Processing test");
      fireEvent.click(sendButton);

      // Input should be disabled during processing
      expect(input).toBeDisabled();
      expect(sendButton).toBeDisabled();

      // Wait for processing to complete
      await waitFor(() => {
        expect(input).not.toBeDisabled();
        expect(sendButton).not.toBeDisabled();
      });
    });

    it("shows processing indicator", async () => {
      const user = userEvent.setup();

      // Mock slow API response
      (global.fetch as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => ({ buffer_length: 100 }),
        }), 100))
      );

      render(<VoiceTreeLayout />);

      const input = screen.getByPlaceholderText(/type or speak your message/i);

      // Submit text
      await user.type(input, "Processing test");
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      // Should show processing indicator
      expect(screen.getByText(/processing/i)).toBeInTheDocument();

      // Wait for processing to complete
      await waitFor(() => {
        expect(screen.queryByText(/processing/i)).not.toBeInTheDocument();
      });
    });
  });

  describe.skip("Dark Mode", () => {
    it("toggles dark mode", async () => {
      const user = userEvent.setup();

      render(<VoiceTreeLayout />);

      // Find dark mode toggle (assuming it exists in TopBar or RadialMenu)
      const darkModeToggle = screen.getByLabelText(/dark mode/i);

      // Click to enable dark mode
      await user.click(darkModeToggle);

      // Check localStorage
      expect(localStorage.getItem('darkMode')).toBe('true');
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      // Click to disable dark mode
      await user.click(darkModeToggle);

      // Check localStorage
      expect(localStorage.getItem('darkMode')).toBe('false');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});