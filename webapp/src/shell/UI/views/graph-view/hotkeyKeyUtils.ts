import type { Modifier } from './hotkeyTypes';

/**
 * Build a lookup key string from a key and optional modifiers.
 * Modifiers are sorted alphabetically for consistent Map keys.
 */
export function getHotkeyKey(key: string, modifiers?: Modifier[]): string {
  const parts: string[] = [];

  if (modifiers && modifiers.length > 0) {
    // Sort modifiers for consistent keys
    const sorted: Modifier[] = [...modifiers].sort();
    parts.push(...sorted);
  }

  parts.push(key);
  return parts.join('+');
}

/**
 * Extract a hotkey lookup key string from a KeyboardEvent.
 * Handles Mac Option+letter producing special characters by using e.code.
 */
export function getHotkeyKeyFromEvent(e: KeyboardEvent): string {
  const modifiers: Modifier[] = [];

  if (e.metaKey) modifiers.push('Meta');
  if (e.ctrlKey) modifiers.push('Control');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');

  const key: string = normalizeKeyboardEventKey(e);

  return getHotkeyKey(key, modifiers);
}

function normalizeKeyboardEventKey(e: KeyboardEvent): string {
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';

  // On Mac, Option+letter produces special characters (e.g., Option+R = "\u00ae").
  // Use e.code to get the physical key and extract the letter for Alt combinations.
  if (e.altKey && e.code.startsWith('Key')) {
    return e.code.slice(3).toLowerCase(); // "KeyR" -> "r"
  }

  return e.key;
}

/**
 * Identify which modifier key (if any) was pressed/released in a KeyboardEvent.
 */
export function getModifierFromEvent(e: KeyboardEvent): Modifier | null {
  if (e.key === 'Meta') return 'Meta';
  if (e.key === 'Control') return 'Control';
  if (e.key === 'Alt') return 'Alt';
  if (e.key === 'Shift') return 'Shift';
  return null;
}
