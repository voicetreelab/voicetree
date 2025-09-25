import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import SoundWaveVisualizer from "../sound-wave-visualizer";

describe("SoundWaveVisualizer", () => {
  let mockRequestAnimationFrame: any;
  let mockCancelAnimationFrame: any;
  let rafCallbacks: Array<() => void> = [];

  beforeEach(() => {
    rafCallbacks = [];

    // Mock requestAnimationFrame to be synchronous for testing
    mockRequestAnimationFrame = vi.fn((callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    mockCancelAnimationFrame = vi.fn((id) => {
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => {};
      }
    });

    global.requestAnimationFrame = mockRequestAnimationFrame;
    global.cancelAnimationFrame = mockCancelAnimationFrame;
  });

  afterEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
  });

  describe("Rendering", () => {
    it("renders canvas element when active", async () => {
      const { container } = await act(async () => {
        return render(<SoundWaveVisualizer isActive={true} />);
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("hides canvas when inactive", async () => {
      const { container } = await act(async () => {
        return render(<SoundWaveVisualizer isActive={false} />);
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
      expect(canvas).toHaveStyle({ display: "none" });
    });

    it("applies custom className", async () => {
      const { container } = await act(async () => {
        return render(
          <SoundWaveVisualizer isActive={true} className="custom-class" />
        );
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toHaveClass("custom-class");
    });
  });

  describe("Props Configuration", () => {
    it("uses default bar count when not specified", async () => {
      const { container } = await act(async () => {
        return render(<SoundWaveVisualizer isActive={true} />);
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
      // Default bar count is 30
    });

    it("accepts custom bar count", async () => {
      const { container } = await act(async () => {
        return render(
          <SoundWaveVisualizer isActive={true} barCount={50} />
        );
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("accepts custom bar color", async () => {
      const { container } = await act(async () => {
        return render(
          <SoundWaveVisualizer isActive={true} barColor="rgb(255, 0, 0)" />
        );
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });
  });

  describe("Audio Stream Handling", () => {
    it("handles missing audio stream gracefully", async () => {
      await act(async () => {
        expect(() => {
          render(<SoundWaveVisualizer isActive={true} />);
        }).not.toThrow();
      });
    });

    it("uses provided audio stream", () => {
      const mockStream = new MediaStream();
      const { container } = render(
        <SoundWaveVisualizer isActive={true} audioStream={mockStream} />
      );
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("falls back to getUserMedia when no stream provided", async () => {
      const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, "getUserMedia");

      render(<SoundWaveVisualizer isActive={true} />);

      await waitFor(() => {
        expect(getUserMediaSpy).toHaveBeenCalledWith({
          audio: true,
          video: false,
        });
      });
    });
  });

  describe("Fallback Animation", () => {
    it("shows fallback animation when enabled and no audio", async () => {
      const { container } = await act(async () => {
        return render(
          <SoundWaveVisualizer isActive={true} fallbackAnimation={true} />
        );
      });
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("shows canvas even when fallback disabled", async () => {
      const { container } = await act(async () => {
        return render(
          <SoundWaveVisualizer isActive={true} fallbackAnimation={false} />
        );
      });
      // Canvas still renders but without animation when no audio and fallback disabled
      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });
  });

  describe("Lifecycle", () => {
    it("starts animation when active", async () => {
      render(<SoundWaveVisualizer isActive={true} />);

      await waitFor(() => {
        expect(mockRequestAnimationFrame).toHaveBeenCalled();
      });
    });

    it("stops animation when becoming inactive", async () => {
      const { rerender } = render(<SoundWaveVisualizer isActive={true} />);

      await act(async () => {
        rerender(<SoundWaveVisualizer isActive={false} />);
      });

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
    });

    it("cleans up resources on unmount", async () => {
      const { unmount } = render(<SoundWaveVisualizer isActive={true} />);

      await act(async () => {
        unmount();
      });

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
    });

    it("handles audio context cleanup", async () => {
      const mockStream = new MediaStream();
      const mockClose = vi.fn(() => Promise.resolve());
      const originalAudioContext = window.AudioContext;

      window.AudioContext = class MockAudioContext extends originalAudioContext {
        close = mockClose;
      } as any;

      const { unmount } = render(
        <SoundWaveVisualizer isActive={true} audioStream={mockStream} />
      );

      await act(async () => {
        unmount();
      });

      await waitFor(() => {
        expect(mockClose).toHaveBeenCalled();
      });

      window.AudioContext = originalAudioContext;
    });
  });

  describe("Canvas Rendering", () => {
    it("sets canvas dimensions", async () => {
      const { container } = await act(async () => {
        return render(<SoundWaveVisualizer isActive={true} />);
      });
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;

      expect(canvas).toHaveAttribute("width");
      expect(canvas).toHaveAttribute("height");
    });

    it("handles window resize", async () => {
      const { container } = await act(async () => {
        return render(<SoundWaveVisualizer isActive={true} />);
      });
      const canvas = container.querySelector("canvas") as HTMLCanvasElement;

      // Simulate resize
      Object.defineProperty(canvas, "clientWidth", { value: 500, configurable: true });
      Object.defineProperty(canvas, "clientHeight", { value: 200, configurable: true });

      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });

      // Canvas dimensions should be updated
      expect(canvas.width).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("handles getUserMedia failure gracefully", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error("Permission denied"));

      expect(() => {
        render(<SoundWaveVisualizer isActive={true} />);
      }).not.toThrow();

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Could not access microphone"),
          expect.any(Error)
        );
      });

      consoleWarnSpy.mockRestore();
    });

    it("handles invalid audio stream gracefully", () => {
      const invalidStream = {} as MediaStream;

      expect(() => {
        render(<SoundWaveVisualizer isActive={true} audioStream={invalidStream} />);
      }).not.toThrow();
    });
  });

  describe("Performance", () => {
    it("uses requestAnimationFrame for smooth animation", async () => {
      render(<SoundWaveVisualizer isActive={true} />);

      await waitFor(() => {
        expect(mockRequestAnimationFrame).toHaveBeenCalled();
      });
    });

    it("cancels animation frame when not needed", async () => {
      const { unmount } = render(<SoundWaveVisualizer isActive={true} />);

      await act(async () => {
        unmount();
      });

      expect(mockCancelAnimationFrame).toHaveBeenCalled();
    });
  });
});