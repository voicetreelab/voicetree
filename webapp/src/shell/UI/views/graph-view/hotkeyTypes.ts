export type Modifier = 'Meta' | 'Control' | 'Alt' | 'Shift';

export interface HotkeyConfig {
  key: string;
  modifiers?: Modifier[];
  onPress: () => void;
  onRelease?: () => void;
  repeatable?: boolean;
  repeatDelay?: number; // milliseconds between repeats (default 150)
  /** If true, this hotkey won't fire when focus is in an editor/input (default: false) */
  disabledInEditors?: boolean;
}

export interface RegisteredHotkey {
  config: HotkeyConfig;
  isPressed: boolean;
  repeatInterval?: number;
}
