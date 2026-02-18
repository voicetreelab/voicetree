import type { JSX } from "react";
import { useState, useEffect, useRef } from "react";
import type { HotkeyBinding, HotkeyModifier } from "@/pure/settings/types";

interface HotkeyFieldProps {
  label: string;
  value: HotkeyBinding;
  onChange: (value: HotkeyBinding) => void;
}

const MODIFIER_KEYS: Set<string> = new Set(["Meta", "Control", "Alt", "Shift"]);

const isMac: boolean =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

const MODIFIER_GLYPHS: Record<HotkeyModifier, string> = isMac
  ? { Meta: "\u2318", Control: "\u2303", Alt: "\u2325", Shift: "\u21E7" }
  : { Meta: "Win", Control: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** Canonical display order: Control, Alt, Shift, Meta (on Mac: ⌃ ⌥ ⇧ ⌘) */
const MODIFIER_ORDER: readonly HotkeyModifier[] = [
  "Control",
  "Alt",
  "Shift",
  "Meta",
];

function sortModifiers(
  modifiers: readonly HotkeyModifier[],
): HotkeyModifier[] {
  const set: Set<HotkeyModifier> = new Set(modifiers);
  return MODIFIER_ORDER.filter((m) => set.has(m));
}

const SPECIAL_KEY_DISPLAY: Record<string, string> = {
  Enter: "\u21A9",
  Backspace: "\u232B",
  Delete: "\u2326",
  Tab: "\u21E5",
  Escape: "Esc",
  ArrowUp: "\u2191",
  ArrowDown: "\u2193",
  ArrowLeft: "\u2190",
  ArrowRight: "\u2192",
  " ": "Space",
};

function displayKey(key: string): string {
  if (SPECIAL_KEY_DISPLAY[key]) return SPECIAL_KEY_DISPLAY[key];
  if (key.length === 1) return key.toUpperCase();
  // Strip "Arrow" prefix if not caught above, handle F-keys etc.
  return key;
}

function Keycap({ children }: { children: string }): JSX.Element {
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-md bg-muted border border-border text-xs font-mono shadow-sm select-none">
      {children}
    </span>
  );
}

export function HotkeyField({
  label,
  value,
  onChange,
}: HotkeyFieldProps): JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const captureRef: React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  // Keyboard listener during capture mode
  useEffect(() => {
    if (!capturing) return;

    function onKeyDown(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }

      // Ignore lone modifier presses — wait for a non-modifier key
      if (MODIFIER_KEYS.has(e.key)) return;

      const modifiers: HotkeyModifier[] = [];
      if (e.metaKey) modifiers.push("Meta");
      if (e.ctrlKey) modifiers.push("Control");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");

      onChange({ key: e.key, modifiers: sortModifiers(modifiers) });
      setCapturing(false);
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, onChange]);

  // Click-outside cancels capture
  useEffect(() => {
    if (!capturing) return;

    function onClickOutside(e: MouseEvent): void {
      if (
        captureRef.current &&
        !captureRef.current.contains(e.target as Node)
      ) {
        setCapturing(false);
      }
    }

    // Delay listener so the click that opened capture doesn't immediately close it
    const id: number = requestAnimationFrame(() => {
      document.addEventListener("mousedown", onClickOutside, true);
    });
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onClickOutside, true);
    };
  }, [capturing]);

  const sorted: HotkeyModifier[] = sortModifiers(value.modifiers);

  return (
    <div className="flex justify-between items-center py-1.5 px-1 min-h-[36px]">
      <span className="font-mono text-sm text-foreground">{label}</span>

      <div ref={captureRef}>
        {capturing ? (
          <div
            className="inline-flex items-center h-7 px-3 rounded-md border-2 border-amber-400 animate-pulse text-xs font-mono text-amber-300 cursor-default select-none"
            role="status"
          >
            Press keys...
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCapturing(true)}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 -my-0.5 hover:bg-muted/60 transition-colors cursor-pointer"
            title="Click to rebind"
          >
            {sorted.map((mod) => (
              <Keycap key={mod}>{MODIFIER_GLYPHS[mod]}</Keycap>
            ))}
            <Keycap>{displayKey(value.key)}</Keycap>
          </button>
        )}
      </div>
    </div>
  );
}
