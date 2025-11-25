import "@testing-library/jest-dom";
import { afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock CSS imports from node_modules
vi.mock('*.css', () => ({}));

// Mock ninja-keys to prevent CSS import issues from @material/mwc-icon
// ninja-keys is a transitive dependency that imports CSS, which breaks Vitest
vi.mock('ninja-keys', () => {
  // Define custom element for ninja-keys
  class NinjaKeysElement extends HTMLElement {
    data: unknown[] = [];

    open() {
      this.dispatchEvent(new Event('opened'));
    }

    close() {
      this.dispatchEvent(new Event('closed'));
    }
  }

  // Register custom element if not already registered
  if (!customElements.get('ninja-keys')) {
    customElements.define('ninja-keys', NinjaKeysElement);
  }

  return {};
});

// Mock console methods to suppress error logs during e2e-tests
beforeAll(() => {
  // Store original console methods
  const originalError = console.error;
  const originalWarn = console.warn;

  // Mock console.error to suppress expected errors
  console.error = vi.fn((...args) => {
    const message = args[0]?.toString() ?? '';
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
    const message = args[0]?.toString() ?? '';
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

// Mock window.addEventListener and removeEventListener for mermaid
if (!window.addEventListener) {
  window.addEventListener = vi.fn();
}
if (!window.removeEventListener) {
  window.removeEventListener = vi.fn();
}

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

// Ensure getComputedStyle is always available (even after test mocking)
// Store the original implementation
const originalGetComputedStyle = globalThis.getComputedStyle;

// Add a robust fallback that always works
if (!originalGetComputedStyle) {
  globalThis.getComputedStyle = (() => ({
    getPropertyValue: () => '',
  })) as unknown as typeof globalThis.getComputedStyle;
} // todo why do we need this? do we really? covering up bug?

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

// Mock HTMLCanvasElement.getContext for SoundWaveVisualizer e2e-tests
HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
  if (contextId === '2d') {
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
    } as unknown as CanvasRenderingContext2D;
  }
  return null;
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

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
} as unknown as typeof AudioContext;

// Mock MediaStream
window.MediaStream = class MediaStream {
  getTracks() {
    return [{
      stop: () => {},
    }];
  }
} as unknown as typeof MediaStream;

// Mock getUserMedia to grant permission and return a mock MediaStream
Object.defineProperty(navigator, "mediaDevices", {
  writable: true,
  value: {
    getUserMedia: vi.fn(() => Promise.resolve({
      getTracks: () => [{
        stop: vi.fn()
      }]
    })),
    enumerateDevices: () => Promise.resolve([]),
  },
});

// Mock navigator.clipboard for user-event e2e-tests
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
  configurable: true
});

// Set navigator.webdriver to true to signal test environment
// This makes LayoutManager use 0ms animation duration instead of 300ms
Object.defineProperty(navigator, 'webdriver', {
  value: true,
  writable: true,
  configurable: true
});

// Mock HTMLElement.scrollTo for useAutoScroll e2e-tests
HTMLElement.prototype.scrollTo = vi.fn();

// Mock window.electronAPI for tests that use Electron IPC
Object.defineProperty(window, 'electronAPI', {
  value: {
    getBackendPort: vi.fn(() => Promise.resolve(8001)),
  },
  writable: true,
  configurable: true
});

// Mock CSS.supports for color validation
// List of known valid CSS color names and patterns
const VALID_CSS_COLORS = new Set([
  'red', 'blue', 'green', 'cyan', 'magenta', 'yellow', 'black', 'white',
  'gray', 'grey', 'orange', 'purple', 'pink', 'brown', 'lime', 'navy',
  'teal', 'aqua', 'maroon', 'olive', 'silver', 'fuchsia', 'transparent'
]);

Object.defineProperty(globalThis, 'CSS', {
  value: {
    supports: vi.fn((property: string, value: string): boolean => {
      if (property !== 'color') return false;
      if (!value) return false;

      // Check hex colors
      if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return true;

      // Check rgb/rgba with value range validation
      const rgbMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);
        const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1;
        // RGB values must be 0-255, alpha must be 0-1
        if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1) {
          return true;
        }
        return false;
      }

      // Check hsl/hsla
      if (/^hsla?\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?\s*(,\s*[\d.]+\s*)?\)$/.test(value)) return true;

      // Check known CSS color names
      if (VALID_CSS_COLORS.has(value.toLowerCase())) return true;

      return false;
    })
  },
  writable: true,
  configurable: true
});