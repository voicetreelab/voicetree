import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecordButton from "../record-button";

describe("RecordButton", () => {
  const mockStartTranscription = vi.fn();
  const mockStopTranscription = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Normal Mode", () => {
    it("renders start button when idle", () => {
      render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button", { name: /start recording/i });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it("renders stop button when running", () => {
      render(
        <RecordButton
          state="Running"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button", { name: /stop recording/i });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it("shows finishing text when in FinishingProcessing state", () => {
      render(
        <RecordButton
          state="FinishingProcessing"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button", { name: /finishing/i });
      expect(button).toBeInTheDocument();
      expect(button).toBeDisabled();
    });

    it("calls startTranscription when start button is clicked", () => {
      render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button", { name: /start recording/i });
      fireEvent.click(button);
      expect(mockStartTranscription).toHaveBeenCalledTimes(1);
    });

    it("calls stopTranscription when stop button is clicked", () => {
      render(
        <RecordButton
          state="Running"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button", { name: /stop recording/i });
      fireEvent.click(button);
      expect(mockStopTranscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("Compact Mode", () => {
    it("renders microphone icon when idle in compact mode", () => {
      render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
          compact={true}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveTextContent("🎤");
      expect(button).toHaveClass("w-12", "h-12", "rounded-full");
    });

    it("renders stop icon when running in compact mode", () => {
      render(
        <RecordButton
          state="Running"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
          compact={true}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveTextContent("⏹️");
      expect(button).toHaveClass("w-12", "h-12", "rounded-full");
    });

    it("applies correct styling for compact mode", () => {
      render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
          compact={true}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveClass("rounded-full", "w-12", "h-12");
    });

    it("maintains functionality in compact mode", () => {
      const { rerender } = render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
          compact={true}
        />
      );

      // Test start
      let button = screen.getByRole("button");
      fireEvent.click(button);
      expect(mockStartTranscription).toHaveBeenCalledTimes(1);

      // Test stop
      rerender(
        <RecordButton
          state="Running"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
          compact={true}
        />
      );

      button = screen.getByRole("button");
      fireEvent.click(button);
      expect(mockStopTranscription).toHaveBeenCalledTimes(1);
    });
  });

  describe("State Transitions", () => {
    const states = ["Idle", "Starting", "Running", "Stopping", "FinishingProcessing"] as const;

    it.each(states)("handles %s state correctly", (state) => {
      render(
        <RecordButton
          state={state}
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();

      // Button should be disabled only during FinishingProcessing
      if (state === "FinishingProcessing") {
        expect(button).toBeDisabled();
      } else {
        expect(button).not.toBeDisabled();
      }
    });
  });

  describe("Styling", () => {
    it("applies red background for stop button", () => {
      render(
        <RecordButton
          state="Running"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-red-600");
    });

    it("applies voicetree background for start button", () => {
      render(
        <RecordButton
          state="Idle"
          startTranscription={mockStartTranscription}
          stopTranscription={mockStopTranscription}
        />
      );

      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-voicetree");
    });
  });
});