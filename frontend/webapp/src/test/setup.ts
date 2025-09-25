import "@testing-library/jest-dom";
import { afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock console methods to suppress error logs during tests
beforeAll(() => {
  // Store original console methods
  const originalError = console.error;
  const originalWarn = console.warn;

  // Mock console.error to suppress expected errors
  console.error = vi.fn((...args) => {
    const message = args[0]?.toString() || '';
    // Suppress expected error messages
    if (
      message.includes('Error sending to VoiceTree') ||
      message.includes('Network error') ||
      message.includes('Failed to fetch')
    ) {
      return;
    }
    // Call original for unexpected errors
    originalError(...args);
  });

  // Mock console.warn to suppress expected warnings
  console.warn = vi.fn((...args) => {
    const message = args[0]?.toString() || '';
    // Suppress expected warning messages
    if (
      message.includes('Could not access microphone for visualization') ||
      message.includes('Permission denied')
    ) {
      return;
    }
    // Call original for unexpected warnings
    originalWarn(...args);
  });
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock localStorage with functional implementation
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
})();
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock HTMLCanvasElement.getContext for SoundWaveVisualizer tests
HTMLCanvasElement.prototype.getContext = (() => {
  return {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({
      data: new Array(4),
    }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
    roundRect: () => {},
    fillStyle: "",
    globalAlpha: 1,
  };
}) as any;

// Mock Web Audio API
window.AudioContext = class AudioContext {
  createAnalyser() {
    return {
      connect: () => {},
      disconnect: () => {},
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: (array: Uint8Array) => {
        // Fill with mock frequency data
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
      },
    };
  }
  createMediaStreamSource() {
    return {
      connect: () => {},
      disconnect: () => {},
    };
  }
  close() {
    return Promise.resolve();
  }
} as any;

// Mock MediaStream
window.MediaStream = class MediaStream {
  getTracks() {
    return [{
      stop: () => {},
    }];
  }
} as any;

// Mock getUserMedia to reject with permission denied (simulating no microphone access)
navigator.mediaDevices = {
  getUserMedia: () => Promise.reject(new Error('Permission denied')),
  enumerateDevices: () => Promise.resolve([]),
} as any;