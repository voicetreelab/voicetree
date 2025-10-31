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
    const key = this.getHotkeyKey(config.key, config.modifiers);

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
    const hotkeyKey = this.getHotkeyKey(key, modifiers);
    const hotkey = this.hotkeys.get(hotkeyKey);

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
  }

  /**
   * Clean up all listeners
   */
  dispose(): void {
    // Stop all repeating hotkeys
    for (const hotkey of this.hotkeys.values()) {
      this.stopRepeating(hotkey);
    }

    // Remove event listeners
    if (this.keyDownHandler) {
      document.removeEventListener('keydown', this.keyDownHandler);
    }
    if (this.keyUpHandler) {
      document.removeEventListener('keyup', this.keyUpHandler);
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
    for (const [modifier, callbacks] of this.modifierCallbacks.entries()) {
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
      const hotkeyKey = this.getHotkeyKeyFromEvent(e);
      const hotkey = this.hotkeys.get(hotkeyKey);

      // Ignore hotkeys when typing in input elements
      // BUT allow hotkeys with modifiers (Command+[, etc.) to work everywhere
      if (this.isInputElement(e.target as HTMLElement)) {
        // Allow hotkeys that have modifiers (Meta, Control, Alt)
        const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
        if (!hasModifier) {
          return; // Block plain keys like Space when in input elements
        }
      }

      if (hotkey && !hotkey.isPressed) {
        console.log(`[HotkeyManager] Hotkey pressed: ${hotkeyKey}`);
        hotkey.isPressed = true;

        // Fire onPress
        hotkey.config.onPress();

        // Setup repeat if enabled
        if (hotkey.config.repeatable) {
          this.startRepeating(hotkey);
        }
      }
    };

    this.keyUpHandler = (e: KeyboardEvent) => {
      // Track modifier keys
      this.handleModifierKeyUp(e);

      // FIX: Reset ALL hotkeys that use this key, regardless of current modifier state
      // This handles the case where Meta is released before the hotkey key
      const releasedKey = e.key;

      for (const [hotkeyKey, hotkey] of this.hotkeys.entries()) {
        // Check if this hotkey uses the released key
        if (hotkey.config.key === releasedKey && hotkey.isPressed) {
          console.log(`[HotkeyManager] Hotkey released: ${hotkeyKey}`);
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

    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('keyup', this.keyUpHandler);

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
    const modifier = this.getModifierFromEvent(e);
    if (modifier) {
      const callbacks = this.modifierCallbacks.get(modifier);
      if (callbacks) {
        callbacks.forEach(cb => cb(true));
      }
    }
  }

  private handleModifierKeyUp(e: KeyboardEvent): void {
    const modifier = this.getModifierFromEvent(e);
    if (modifier) {
      const callbacks = this.modifierCallbacks.get(modifier);
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
    const delay = hotkey.config.repeatDelay || 150;

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
      const sorted = [...modifiers].sort();
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
