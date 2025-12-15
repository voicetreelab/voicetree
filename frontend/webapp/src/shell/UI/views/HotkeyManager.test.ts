import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { HotkeyManager } from './HotkeyManager';

describe('HotkeyManager', () => {
  let hotkeyManager: HotkeyManager;

  beforeEach(() => {
    hotkeyManager = new HotkeyManager();
  });

  afterEach(() => {
    hotkeyManager.dispose();
  });

  describe('isInputElement detection via composedPath', () => {
    it('should block plain Space key when focus is on INPUT element', () => {
      const input: HTMLInputElement = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const pressHandler: Mock = vi.fn();
      hotkeyManager.registerHotkey({
        key: ' ',
        onPress: pressHandler
      });

      // Simulate space key press with input as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        composed: true
      });
      input.dispatchEvent(event);

      // Handler should NOT be called because we're in an input element
      expect(pressHandler).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('should allow Space key when focus is on non-input element', () => {
      const div: HTMLDivElement = document.createElement('div');
      document.body.appendChild(div);
      div.focus();

      const pressHandler: Mock = vi.fn();
      hotkeyManager.registerHotkey({
        key: ' ',
        onPress: pressHandler
      });

      // Simulate space key press with div as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        composed: true
      });
      div.dispatchEvent(event);

      expect(pressHandler).toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it('should detect INPUT inside shadow DOM via composedPath', () => {
      // Create a custom element with shadow DOM containing an input
      class TestShadowElement extends HTMLElement {
        constructor() {
          super();
          const shadow: ShadowRoot = this.attachShadow({ mode: 'open' });
          const input: HTMLInputElement = document.createElement('input');
          input.id = 'shadow-input';
          shadow.appendChild(input);
        }
      }
      customElements.define('test-shadow-element', TestShadowElement);

      const shadowHost: TestShadowElement = document.createElement('test-shadow-element') as TestShadowElement;
      document.body.appendChild(shadowHost);

      const shadowInput: HTMLInputElement = shadowHost.shadowRoot?.getElementById('shadow-input') as HTMLInputElement;
      shadowInput.focus();

      const pressHandler: Mock = vi.fn();
      hotkeyManager.registerHotkey({
        key: ' ',
        onPress: pressHandler
      });

      // Create a keyboard event and dispatch from the shadow input
      // The event.target will be the shadow host, but composedPath() includes the actual input
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        composed: true
      });
      shadowInput.dispatchEvent(event);

      // Handler should NOT be called because we detect the input via composedPath
      expect(pressHandler).not.toHaveBeenCalled();

      document.body.removeChild(shadowHost);
    });

    it('should allow modifier keys (Meta) even when in input element', () => {
      const input: HTMLInputElement = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const pressHandler: Mock = vi.fn();
      hotkeyManager.registerHotkey({
        key: 'k',
        modifiers: ['Meta'],
        onPress: pressHandler
      });

      // Simulate Cmd+K key press with input as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
        composed: true
      });
      input.dispatchEvent(event);

      // Handler SHOULD be called because it has a modifier
      expect(pressHandler).toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('should NOT fire hotkeys marked as disabledInEditors when in input element', () => {
      const input: HTMLInputElement = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const pressHandler: Mock = vi.fn();
      hotkeyManager.registerHotkey({
        key: 'z',
        modifiers: ['Meta'],
        disabledInEditors: true,
        onPress: pressHandler
      });

      // Simulate Cmd+Z key press with input as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        bubbles: true,
        composed: true
      });
      input.dispatchEvent(event);

      // Handler should NOT be called because disabledInEditors is true
      expect(pressHandler).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('should let unregistered modifier combos pass through to editor (e.g., Cmd+A)', () => {
      const input: HTMLInputElement = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      // Don't register Cmd+A - it should pass through to the editor
      const pressHandler: Mock = vi.fn();

      // Simulate Cmd+A key press with input as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'a',
        metaKey: true,
        bubbles: true,
        composed: true
      });
      input.dispatchEvent(event);

      // No registered handler, so nothing fires - event passes through
      expect(pressHandler).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  describe('setupGraphHotkeys', () => {
    it('should register Cmd+W hotkey and invoke closeSelectedWindow callback', () => {
      const closeSelectedWindowHandler: Mock = vi.fn();

      hotkeyManager.setupGraphHotkeys({
        fitToLastNode: vi.fn(),
        cycleTerminal: vi.fn(),
        createNewNode: vi.fn(),
        runTerminal: vi.fn(),
        deleteSelectedNodes: vi.fn(),
        navigateToRecentNode: vi.fn(),
        closeSelectedWindow: closeSelectedWindowHandler
      });

      // Focus on a non-input element to ensure the hotkey is not blocked
      const div: HTMLDivElement = document.createElement('div');
      document.body.appendChild(div);
      div.focus();

      // Simulate Cmd+W key press
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
        composed: true
      });
      div.dispatchEvent(event);

      // Handler should be called
      expect(closeSelectedWindowHandler).toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it('should invoke closeSelectedWindow even when in input element (to close editor/terminal)', () => {
      const input: HTMLInputElement = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const closeSelectedWindowHandler: Mock = vi.fn();

      hotkeyManager.setupGraphHotkeys({
        fitToLastNode: vi.fn(),
        cycleTerminal: vi.fn(),
        createNewNode: vi.fn(),
        runTerminal: vi.fn(),
        deleteSelectedNodes: vi.fn(),
        navigateToRecentNode: vi.fn(),
        closeSelectedWindow: closeSelectedWindowHandler
      });

      // Simulate Cmd+W key press with input as target
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key: 'w',
        metaKey: true,
        bubbles: true,
        composed: true
      });
      input.dispatchEvent(event);

      // Handler SHOULD be called - Cmd+W should close the editor even when focused inside it
      expect(closeSelectedWindowHandler).toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });
});
