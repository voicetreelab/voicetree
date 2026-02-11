// Import to make Window.electronAPI type available
import type {} from '@/shell/electron';
import { MAX_RECENT_NODES } from '@/pure/graph/recentNodeHistoryV2';
import type { HotkeySettings, HotkeyBinding, VTSettings } from '@/pure/settings/types';
import { DEFAULT_HOTKEYS } from '@/pure/settings/DEFAULT_SETTINGS';
import type { Modifier, HotkeyConfig } from './hotkeyTypes';

/**
 * Setup all graph-specific hotkeys.
 * Centralizes hotkey configuration in one place.
 * Takes a registerHotkey callback so it stays decoupled from HotkeyManager internals.
 */
export function setupGraphHotkeys(
  registerHotkey: (config: HotkeyConfig) => void,
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
  // Space: Fit to last created node (repeatable while held)
  registerHotkey({
    key: hotkeys.fitToLastNode.key,
    modifiers: [...hotkeys.fitToLastNode.modifiers] as Modifier[],
    repeatable: true,
    repeatDelay: 150,
    onPress: callbacks.fitToLastNode
  });

  // Next terminal
  registerHotkey({
    key: hotkeys.nextTerminal.key,
    modifiers: [...hotkeys.nextTerminal.modifiers] as Modifier[],
    onPress: () => callbacks.cycleTerminal(1)
  });

  // Previous terminal
  registerHotkey({
    key: hotkeys.prevTerminal.key,
    modifiers: [...hotkeys.prevTerminal.modifiers] as Modifier[],
    onPress: () => callbacks.cycleTerminal(-1)
  });

  // Create new node
  registerHotkey({
    key: hotkeys.createNewNode.key,
    modifiers: [...hotkeys.createNewNode.modifiers] as Modifier[],
    onPress: callbacks.createNewNode
  });

  // Run terminal/coding agent
  registerHotkey({
    key: hotkeys.runTerminal.key,
    modifiers: [...hotkeys.runTerminal.modifiers] as Modifier[],
    onPress: callbacks.runTerminal
  });

  // Undo - uses same modifier as other hotkeys for platform consistency
  // Disabled in editors so CodeMirror/terminals handle their own undo
  const primaryModifier: Modifier = hotkeys.closeWindow.modifiers[0] as Modifier ?? 'Meta';
  registerHotkey({
    key: 'z',
    modifiers: [primaryModifier],
    disabledInEditors: true,
    onPress: () => {
      void window.electronAPI?.main.performUndo();
    }
  });

  // Redo - uses same modifier as other hotkeys for platform consistency
  // Disabled in editors so CodeMirror/terminals handle their own redo
  registerHotkey({
    key: 'z',
    modifiers: [primaryModifier, 'Shift'],
    disabledInEditors: true,
    onPress: () => {
      void window.electronAPI?.main.performRedo();
    }
  });

  // Delete selected nodes
  registerHotkey({
    key: hotkeys.deleteSelectedNodes.key,
    modifiers: [...hotkeys.deleteSelectedNodes.modifiers] as Modifier[],
    onPress: callbacks.deleteSelectedNodes
  });

  // Close editor/terminal for selected node
  // NOTE: NOT disabled in editors - we want to close the editor/terminal even when focused inside it
  registerHotkey({
    key: hotkeys.closeWindow.key,
    modifiers: [...hotkeys.closeWindow.modifiers] as Modifier[],
    onPress: callbacks.closeSelectedWindow
  });

  // Navigate to recent node tabs (1-5)
  const recentNodeBindings: HotkeyBinding[] = [
    hotkeys.recentNode1,
    hotkeys.recentNode2,
    hotkeys.recentNode3,
    hotkeys.recentNode4,
    hotkeys.recentNode5
  ];
  for (let i: number = 0; i < Math.min(MAX_RECENT_NODES, recentNodeBindings.length); i++) {
    const binding: HotkeyBinding = recentNodeBindings[i];
    registerHotkey({
      key: binding.key,
      modifiers: [...binding.modifiers] as Modifier[],
      onPress: () => callbacks.navigateToRecentNode(i)
    });
  }

  // Open settings editor
  registerHotkey({
    key: hotkeys.openSettings.key,
    modifiers: [...hotkeys.openSettings.modifiers] as Modifier[],
    onPress: callbacks.openSettings
  });

  // Search - disabled in editors so CodeMirror can handle its own find
  registerHotkey({
    key: hotkeys.openSearch.key,
    modifiers: [...hotkeys.openSearch.modifiers] as Modifier[],
    disabledInEditors: true,
    onPress: callbacks.openSearch
  });

  // Recent nodes ninja (alt search) - works everywhere including editors
  registerHotkey({
    key: hotkeys.openSearchAlt.key,
    modifiers: [...hotkeys.openSearchAlt.modifiers] as Modifier[],
    onPress: callbacks.openSearch
  });
}

/**
 * Register voice recording hotkey.
 * Separated from setupGraphHotkeys since it needs VoiceRecordingController which initializes later.
 */
export function registerVoiceHotkey(
  registerHotkey: (config: HotkeyConfig) => void,
  onToggle: () => void,
  binding: HotkeyBinding
): void {
  registerHotkey({
    key: binding.key,
    modifiers: [...binding.modifiers] as Modifier[],
    onPress: onToggle
  });
}

/**
 * Initialize hotkeys with settings loaded from electron.
 * Handles async settings loading internally, with platform-aware defaults as fallback.
 */
export async function initializeWithSettings(
  registerHotkey: (config: HotkeyConfig) => void,
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
  const settings: VTSettings | null = await window.electronAPI?.main.loadSettings() ?? null;
  const hotkeys: HotkeySettings = settings?.hotkeys ?? DEFAULT_HOTKEYS;

  setupGraphHotkeys(registerHotkey, callbacks, hotkeys);
  registerVoiceHotkey(registerHotkey, voiceAction, hotkeys.voiceRecording);
}
