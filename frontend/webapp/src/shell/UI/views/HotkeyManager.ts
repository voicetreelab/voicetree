/**
 * HotkeyManager - Centralized keyboard shortcut management
 *
 * Features:
 * - Single document-level listener for all hotkeys
 * - Support for key combinations with modifiers
 * - Support for holding keys with configurable repeat rate
 * - Modifier key tracking for features like command-hover
 * - Clean registration/cleanup API
 */

// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';

export type Modifier = 'Meta' | 'Control' | 'Alt' | 'Shift';

export interface HotkeyConfig {
  key: string;
  modifiers?: Modifier[];
  onPress: () => void;
  onRelease?: () => void;
  repeatable?: boolean;
  repeatDelay?: number; // milliseconds between repeats (default 150)
}

interface RegisteredHotkey {
  config: HotkeyConfig;
  isPressed: boolean;
  repeatInterval?: number;
}

/**
 * Centralized hotkey management for the application
 */
export class HotkeyManager {
  private hotkeys: Map<string, RegisteredHotkey> = new Map();
  private modifierCallbacks: Map<Modifier, ((held: boolean) => void)[]> = new Map();
  private keyDownHandler?: (e: KeyboardEvent) => void;
  private keyUpHandler?: (e: KeyboardEvent) => void;
  private blurHandler?: () => void;
  private visibilityHandler?: () => void;

  constructor() {
    this.setupListeners();
  }

  /**
   * Register a hotkey with optional modifiers
   */
  registerHotkey(config: HotkeyConfig): void {
    const key: string = this.getHotkeyKey(config.key, config.modifiers);

    if (this.hotkeys.has(key)) {
      console.warn(`[HotkeyManager] Hotkey already registered: ${key}`);
      return;
    }

    this.hotkeys.set(key, {
      config,
      isPressed: false
    });

    console.log(`[HotkeyManager] Registered hotkey: ${key}`);
  }

  /**
   * Unregister a hotkey
   */
  unregisterHotkey(key: string, modifiers?: Modifier[]): void {
    const hotkeyKey: string = this.getHotkeyKey(key, modifiers);
    const hotkey: RegisteredHotkey | undefined = this.hotkeys.get(hotkeyKey);

    if (hotkey) {
      this.stopRepeating(hotkey);
      this.hotkeys.delete(hotkeyKey);
      console.log(`[HotkeyManager] Unregistered hotkey: ${hotkeyKey}`);
    }
  }

  /**
   * Track modifier key state changes (for features like command-hover)
   */
  onModifierChange(modifier: Modifier, callback: (held: boolean) => void): void {
    if (!this.modifierCallbacks.has(modifier)) {
      this.modifierCallbacks.set(modifier, []);
    }
    this.modifierCallbacks.get(modifier)!.push(callback);
  }

  /**
   * Setup all graph-specific hotkeys
   * Centralizes hotkey configuration in one place
   */
  setupGraphHotkeys(callbacks: {
    fitToLastNode: () => void;
    cycleTerminal: (direction: 1 | -1) => void;
    createNewNode: () => void;
    runTerminal: () => void;
    deleteSelectedNodes: () => void;
  }): void {
    // Space: Fit to last created node (repeatable while held)
    this.registerHotkey({
      key: ' ',
      repeatable: true,
      repeatDelay: 150,
      onPress: callbacks.fitToLastNode
    });

    // Command + ]: Next terminal
    this.registerHotkey({
      key: ']',
      modifiers: ['Meta'],
      onPress: () => callbacks.cycleTerminal(1)
    });

    // Command + [: Previous terminal
    this.registerHotkey({
      key: '[',
      modifiers: ['Meta'],
      onPress: () => callbacks.cycleTerminal(-1)
    });

    // Control + ]: Next terminal (for non-Mac users)
    this.registerHotkey({
      key: ']',
      modifiers: ['Control'],
      onPress: () => callbacks.cycleTerminal(1)
    });

    // Control + [: Previous terminal (for non-Mac users)
    this.registerHotkey({
      key: '[',
      modifiers: ['Control'],
      onPress: () => callbacks.cycleTerminal(-1)
    });

    // Command + N: Create new node
    this.registerHotkey({
      key: 'n',
      modifiers: ['Meta'],
      onPress: callbacks.createNewNode
    });

    // Command + Enter: Run terminal/coding agent
    this.registerHotkey({
      key: 'Enter',
      modifiers: ['Meta'],
      onPress: callbacks.runTerminal
    });

    // Command + Z: Undo (no callback needed - calls main process directly)
    this.registerHotkey({
      key: 'z',
      modifiers: ['Meta'],
      onPress: () => {
        void window.electronAPI?.main.performUndo();
      }
    });

    // Command + Shift + Z: Redo (no callback needed - calls main process directly)
    this.registerHotkey({
      key: 'z',
      modifiers: ['Meta', 'Shift'],
      onPress: () => {
        void window.electronAPI?.main.performRedo();
      }
    });

    // Command + Backspace: Delete selected nodes
    this.registerHotkey({
      key: 'Backspace',
      modifiers: ['Meta'],
      onPress: callbacks.deleteSelectedNodes
    });
  }

  /**
   * Clean up all listeners
   */
  dispose(): void {
    // Stop all repeating hotkeys
    for (const hotkey of this.hotkeys.values()) {
      this.stopRepeating(hotkey);
    }

    // Remove event listeners (must use same options as addEventListener)
    if (this.keyDownHandler) {
      document.removeEventListener('keydown', this.keyDownHandler, { capture: true });
    }
    if (this.keyUpHandler) {
      document.removeEventListener('keyup', this.keyUpHandler, { capture: true });
    }
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
    }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }

    this.hotkeys.clear();
    this.modifierCallbacks.clear();
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Reset all hotkeys to unpressed state
   * Used when window loses focus to prevent stuck keys
   */
  private resetAllHotkeys(): void {
    console.log('[HotkeyManager] Resetting all hotkeys (focus lost or visibility change)');

    for (const [hotkeyKey, hotkey] of this.hotkeys.entries()) {
      if (hotkey.isPressed) {
        console.log(`[HotkeyManager] Resetting stuck hotkey: ${hotkeyKey}`);
        hotkey.isPressed = false;
        this.stopRepeating(hotkey);

        // Fire onRelease if provided
        if (hotkey.config.onRelease) {
          hotkey.config.onRelease();
        }
      }
    }

    // Also notify all modifier callbacks that modifiers are released
    for (const callbacks of this.modifierCallbacks.values()) {
      callbacks.forEach(cb => cb(false));
    }
  }

  private setupListeners(): void {
    this.keyDownHandler = (e: KeyboardEvent) => {

      // Prevent browser default for Meta+[ and Meta+] (browser back/forward navigation)
      // MUST be done FIRST, before any other logic
      if ((e.key === '[' || e.key === ']') && e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Track modifier keys
      this.handleModifierKeyDown(e);

      // Check for matching hotkey
      const hotkeyKey: string = this.getHotkeyKeyFromEvent(e);
      const hotkey: RegisteredHotkey | undefined = this.hotkeys.get(hotkeyKey);

      // Ignore hotkeys when typing in input elements
      // BUT allow hotkeys with modifiers (Command+[, etc.) to work everywhere
      if (this.isInputElement(e.target as HTMLElement)) {
        // Allow hotkeys that have modifiers (Meta, Control, Alt)
        const hasModifier: boolean = e.metaKey || e.ctrlKey || e.altKey;
        if (!hasModifier) {
          return; // Block plain keys like Space when in input elements
        }
      }

      if (hotkey) {
        // Allow firing if either:
        // 1. Hotkey is not currently pressed, OR
        // 2. This is a fresh keypress (not a repeat) - handles case where OS doesn't send keyup events
        const shouldFire: boolean = !hotkey.isPressed || !e.repeat;

        if (shouldFire) {
          // Prevent default to stop the key from being handled by the focused element
          // (e.g., prevents Cmd+Enter from inserting a newline in CodeMirror editors)
          e.preventDefault();

          // Fire onPress
          hotkey.config.onPress();

          // Mark as pressed and setup repeat only on first press
          if (!hotkey.isPressed) {
            hotkey.isPressed = true;

            // Setup repeat if enabled
            if (hotkey.config.repeatable) {
              this.startRepeating(hotkey);
            }
          }
        }
      }
    };

    this.keyUpHandler = (e: KeyboardEvent) => {
      // Prevent browser default for Meta+[ and Meta+] (browser back/forward navigation)
      // MUST be done FIRST, before any other logic
      if ((e.key === '[' || e.key === ']') && e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Track modifier keys
      this.handleModifierKeyUp(e);

      // FIX: Reset ALL hotkeys that use this key OR modifier, regardless of current modifier state
      // This handles the case where either the main key OR a modifier is released before the other
      const releasedKey: string = e.key;
      const releasedModifier: Modifier | null = this.getModifierFromEvent(e);

      for (const [_hotkeyKey, hotkey] of this.hotkeys.entries()) {
        if (!hotkey.isPressed) continue;

        // Check if this hotkey uses the released key as its main key
        const usesReleasedKey: boolean = hotkey.config.key === releasedKey;

        // Check if this hotkey uses the released modifier
        const usesReleasedModifier: boolean | null | undefined = releasedModifier &&
          hotkey.config.modifiers?.includes(releasedModifier);

        if (usesReleasedKey || usesReleasedModifier) {
          hotkey.isPressed = false;

          // Stop repeating
          this.stopRepeating(hotkey);

          // Fire onRelease if provided
          if (hotkey.config.onRelease) {
            hotkey.config.onRelease();
          }
        }
      }
    };

    // Use capture phase to intercept events BEFORE browser's default handling
    // This is critical for Meta+[ and Meta+] to prevent browser navigation suppressing events
    document.addEventListener('keydown', this.keyDownHandler, { capture: true });
    document.addEventListener('keyup', this.keyUpHandler, { capture: true });

    // Handle window blur (focus lost) - prevents stuck keys
    this.blurHandler = () => {
      this.resetAllHotkeys();
    };
    window.addEventListener('blur', this.blurHandler);

    // Handle visibility change (tab hidden) - additional safety
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.resetAllHotkeys();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * Check if the event target is an input element (terminal, editor, textarea, etc.)
   */
  private isInputElement(element: HTMLElement | null): boolean {
    if (!element) return false;

    // Check if element is editable
    if (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true'
    ) {
      return true;
    }

    // Check for xterm terminal (has class 'xterm' or parent has class 'xterm-screen')
    if (
      element.classList.contains('xterm') ||
      element.classList.contains('xterm-screen') ||
      element.closest('.xterm')
    ) {
      return true;
    }

    // Check for CodeMirror editor
    if (
      element.classList.contains('cm-content') ||
      element.classList.contains('cm-editor') ||
      element.closest('.cm-editor')
    ) {
      return true;
    }

    return false;
  }

  private handleModifierKeyDown(e: KeyboardEvent): void {
    const modifier: Modifier | null = this.getModifierFromEvent(e);
    if (modifier) {
      const callbacks: ((held: boolean) => void)[] | undefined = this.modifierCallbacks.get(modifier);
      if (callbacks) {
        callbacks.forEach(cb => cb(true));
      }
    }
  }

  private handleModifierKeyUp(e: KeyboardEvent): void {
    const modifier: Modifier | null = this.getModifierFromEvent(e);
    if (modifier) {
      const callbacks: ((held: boolean) => void)[] | undefined = this.modifierCallbacks.get(modifier);
      if (callbacks) {
        callbacks.forEach(cb => cb(false));
      }
    }
  }

  private getModifierFromEvent(e: KeyboardEvent): Modifier | null {
    if (e.key === 'Meta') return 'Meta';
    if (e.key === 'Control') return 'Control';
    if (e.key === 'Alt') return 'Alt';
    if (e.key === 'Shift') return 'Shift';
    return null;
  }

  private startRepeating(hotkey: RegisteredHotkey): void {
    const delay: number = hotkey.config.repeatDelay ?? 150;

    hotkey.repeatInterval = window.setInterval(() => {
      if (hotkey.isPressed) {
        hotkey.config.onPress();
      }
    }, delay);
  }

  private stopRepeating(hotkey: RegisteredHotkey): void {
    if (hotkey.repeatInterval) {
      clearInterval(hotkey.repeatInterval);
      hotkey.repeatInterval = undefined;
    }
  }

  private getHotkeyKey(key: string, modifiers?: Modifier[]): string {
    const parts: string[] = [];

    if (modifiers && modifiers.length > 0) {
      // Sort modifiers for consistent keys
      const sorted: Modifier[] = [...modifiers].sort();
      parts.push(...sorted);
    }

    parts.push(key);
    return parts.join('+');
  }

  private getHotkeyKeyFromEvent(e: KeyboardEvent): string {
    const modifiers: Modifier[] = [];

    if (e.metaKey) modifiers.push('Meta');
    if (e.ctrlKey) modifiers.push('Control');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');

    return this.getHotkeyKey(e.key, modifiers);
  }
}
