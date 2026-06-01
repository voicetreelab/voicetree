// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";

import { CodeMirrorEditorView } from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";

/**
 * Behavioral coverage for the reactive dark/light theme switch.
 *
 * The reported bug: an editor opened in dark mode stayed dark after a
 * dark→light toggle (oneDark was injected once at construction and never
 * removed). The fix holds the theme in a CodeMirror `Compartment` and
 * reconfigures it from the dark-mode observer, so the theme follows the
 * document's `dark` class live, in both directions, on already-open editors.
 *
 * `oneDark` is built with `{ dark: true }`, which sets the
 * `EditorView.darkTheme` facet. Reading that facet off the live editor state
 * is the precise observable of whether oneDark is actually in the running
 * configuration — i.e. the exact side effect the theme Compartment toggles.
 */
function oneDarkActive(editor: CodeMirrorEditorView): boolean {
  const view: EditorView = (editor as unknown as { view: EditorView }).view;
  return view.state.facet(EditorView.darkTheme);
}

// jsdom delivers MutationObserver callbacks as microtasks; a macrotask tick
// guarantees the observer has run and the reconfigure transaction applied.
function flushObserver(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setDocumentDark(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

export function describeDarkModeThemeReactivityTests(): void {
  describe("Dark-mode theme reactivity", () => {
    let container: HTMLElement;
    let editor: CodeMirrorEditorView;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      document.documentElement.classList.remove("dark");
    });

    afterEach(() => {
      document.documentElement.classList.remove("dark");
      if (editor && !editor.isDisposed) {
        editor.dispose();
      }
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    });

    it("removes oneDark live on dark→light and restores it on light→dark (markdown)", async () => {
      setDocumentDark(true);
      editor = new CodeMirrorEditorView(container, "# Hello");
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Built in dark mode → oneDark present.
      expect(oneDarkActive(editor)).toBe(true);

      // dark → light: oneDark must be removed WITHOUT close/reopen (the reported bug).
      setDocumentDark(false);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(false);
      expect(container.getAttribute("data-color-mode")).toBe("light");

      // light → dark: oneDark must come back live too.
      setDocumentDark(true);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(true);
      expect(container.getAttribute("data-color-mode")).toBe("dark");
    });

    it("adds oneDark live on light→dark when the editor was built in light mode (markdown)", async () => {
      setDocumentDark(false);
      editor = new CodeMirrorEditorView(container, "# Hello");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(oneDarkActive(editor)).toBe(false);

      setDocumentDark(true);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(true);

      setDocumentDark(false);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(false);
    });

    it("reacts to theme toggles even when the editor is readonly/pinned (markdown)", async () => {
      setDocumentDark(true);
      editor = new CodeMirrorEditorView(container, "# Hello", {
        startReadonly: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(oneDarkActive(editor)).toBe(true);

      setDocumentDark(false);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(false);
    });

    it("removes oneDark live on dark→light for JSON editors too", async () => {
      setDocumentDark(true);
      editor = new CodeMirrorEditorView(container, '{"k": 1}', {
        language: "json",
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(oneDarkActive(editor)).toBe(true);

      setDocumentDark(false);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(false);

      setDocumentDark(true);
      await flushObserver();
      expect(oneDarkActive(editor)).toBe(true);
    });
  });
}
