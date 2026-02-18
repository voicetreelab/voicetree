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

import type { HotkeySettings, HotkeyBinding } from '@/pure/settings/types';
import type { Modifier, HotkeyConfig, RegisteredHotkey } from './hotkeyTypes';
import { getHotkeyKey, getHotkeyKeyFromEvent, getModifierFromEvent } from './hotkeyKeyUtils';
import { isInputElement } from './inputElementDetection';
import {
  setupGraphHotkeys as setupGraphHotkeysImpl,
  registerVoiceHotkey as registerVoiceHotkeyImpl,
  initializeWithSettings as initializeWithSettingsImpl
} from './graphHotkeyBindings';

// Re-export types for backward compatibility
export type { Modifier, HotkeyConfig } from './hotkeyTypes';

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
    const key: string = getHotkeyKey(config.key, config.modifiers);

    if (this.hotkeys.has(key)) {
      console.warn(`[HotkeyManager] Hotkey already registered: ${key}`);
      return;
    }

    this.hotkeys.set(key, {
      config,
      isPressed: false
    });

    //console.log(`[HotkeyManager] Registered hotkey: ${key}`);
  }

  /**
   * Unregister a hotkey
   */
  unregisterHotkey(key: string, modifiers?: Modifier[]): void {
    const hotkeyKey: string = getHotkeyKey(key, modifiers);
    const hotkey: RegisteredHotkey | undefined = this.hotkeys.get(hotkeyKey);

    if (hotkey) {
      this.stopRepeating(hotkey);
      this.hotkeys.delete(hotkeyKey);
      //console.log(`[HotkeyManager] Unregistered hotkey: ${hotkeyKey}`);
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
  setupGraphHotkeys(
    callbacks: {
      fitToLastNode: () => void;
      cycleTerminal: (direction: 1 | -1) => void;
      createNewNode: () => void;
      runTerminal: () => void;
      deleteSelectedNodes: () => void;
      navigateToRecentNode: (index: number) => void;
      closeSelectedWindow: () => void;
      openSettings: () => void;
      openSearch: () => void;
    },
    hotkeys: HotkeySettings
  ): void {
    setupGraphHotkeysImpl(
      (config: HotkeyConfig) => this.registerHotkey(config),
      callbacks,
      hotkeys
    );
  }

  /**
   * Register voice recording hotkey
   * Separated from setupGraphHotkeys since it needs VoiceRecordingController which initializes later
   */
  registerVoiceHotkey(onToggle: () => void, binding: HotkeyBinding): void {
    registerVoiceHotkeyImpl(
      (config: HotkeyConfig) => this.registerHotkey(config),
      onToggle,
      binding
    );
  }

  /**
   * Initialize hotkeys with settings loaded from electron
   * Handles async settings loading internally, with platform-aware defaults as fallback
   */
  async initializeWithSettings(
    callbacks: {
      fitToLastNode: () => void;
      cycleTerminal: (direction: 1 | -1) => void;
      createNewNode: () => void;
      runTerminal: () => void;
      deleteSelectedNodes: () => void;
      navigateToRecentNode: (index: number) => void;
      closeSelectedWindow: () => void;
      openSettings: () => void;
      openSearch: () => void;
    },
    voiceAction: () => void
  ): Promise<void> {
    await initializeWithSettingsImpl(
      (config: HotkeyConfig) => this.registerHotkey(config),
      callbacks,
      voiceAction
    );
  }

  /**
   * Clear all hotkeys and re-initialize from current settings.
   * Used when settings change at runtime (e.g., hotkey rebinding).
   */
  async refreshHotkeys(
    callbacks: {
      fitToLastNode: () => void;
      cycleTerminal: (direction: 1 | -1) => void;
      createNewNode: () => void;
      runTerminal: () => void;
      deleteSelectedNodes: () => void;
      navigateToRecentNode: (index: number) => void;
      closeSelectedWindow: () => void;
      openSettings: () => void;
      openSearch: () => void;
    },
    voiceAction: () => void
  ): Promise<void> {
    for (const hotkey of this.hotkeys.values()) {
      if (hotkey.repeatInterval) {
        clearInterval(hotkey.repeatInterval);
      }
    }
    this.hotkeys.clear();
    await this.initializeWithSettings(callbacks, voiceAction);
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
    //console.log('[HotkeyManager] Resetting all hotkeys (focus lost or visibility change)');

    for (const [_hotkeyKey, hotkey] of this.hotkeys.entries()) {
      if (hotkey.isPressed) {
        //console.log(`[HotkeyManager] Resetting stuck hotkey: ${hotkeyKey}`);
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
      const hotkeyKey: string = getHotkeyKeyFromEvent(e);
      const hotkey: RegisteredHotkey | undefined = this.hotkeys.get(hotkeyKey);

      // DEBUG: Log hotkey attempts for Meta+W
      //if (e.metaKey && e.key.toLowerCase() === 'w') {
      //  const isInput: boolean = isInputElement(e.target as HTMLElement, e);
      //  console.log(`[HotkeyManager] Cmd+W pressed:`, {
      //    hotkeyKey,
      //    hotkeyFound: !!hotkey,
      //    disabledInEditors: hotkey?.config.disabledInEditors,
      //    isInputElement: isInput,
      //    target: (e.target as HTMLElement)?.tagName,
      //    targetClasses: (e.target as HTMLElement)?.className
      //  });
      //}

      // Ignore hotkeys when typing in input elements
      // Only intercept if we have a registered hotkey that's allowed in editors
      // This allows standard edit commands (Cmd+A, Cmd+C, Cmd+V, Cmd+Z, etc.) to pass through
      if (isInputElement(e.target as HTMLElement, e)) {
        const hasModifier: boolean = e.metaKey || e.ctrlKey || e.altKey;
        if (!hasModifier) {
          return; // Block plain keys like Space when in input elements
        }

        // Only intercept modifier combos that we've explicitly registered AND allowed in editors
        // Let everything else pass through to the editor
        if (!hotkey || hotkey.config.disabledInEditors) {
          return;
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
      const releasedModifier: Modifier | null = getModifierFromEvent(e);

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

  private handleModifierKeyDown(e: KeyboardEvent): void {
    const modifier: Modifier | null = getModifierFromEvent(e);
    if (modifier) {
      const callbacks: ((held: boolean) => void)[] | undefined = this.modifierCallbacks.get(modifier);
      if (callbacks) {
        callbacks.forEach(cb => cb(true));
      }
    }
  }

  private handleModifierKeyUp(e: KeyboardEvent): void {
    const modifier: Modifier | null = getModifierFromEvent(e);
    if (modifier) {
      const callbacks: ((held: boolean) => void)[] | undefined = this.modifierCallbacks.get(modifier);
      if (callbacks) {
        callbacks.forEach(cb => cb(false));
      }
    }
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
}
