// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
} from "vitest";

// Mock window event listeners before importing CodeMirrorEditorView
// This prevents mermaid from failing during module initialization
beforeAll(() => {
  if (!global.window.addEventListener) {
    global.window.addEventListener = vi.fn();
  }
  if (!global.window.removeEventListener) {
    global.window.removeEventListener = vi.fn();
  }
});

import { CodeMirrorEditorView } from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";
import { describeHasFrontmatterTests } from "./CodeMirrorEditorView.test/__tests__/hasFrontmatter";
import { describeImagePasteHandlerTests } from "./CodeMirrorEditorView.test/__tests__/imagePasteHandler";
import { describeDarkModeThemeReactivityTests } from "./CodeMirrorEditorView.test/__tests__/darkModeThemeReactivity";

interface CodeMirrorElement extends HTMLElement {
  cmView?: {
    view: CMEditorView;
  };
}

type CMEditorView = {
  dispatch: (spec: unknown) => void;
  state: {
    doc: { length: number; toString: () => string };
    selection: { main: { head: number } };
  };
};

describe("Frontmatter Parsing", () => {
  let container: HTMLElement;
  let editor: CodeMirrorEditorView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor && !editor.isDisposed) {
      editor.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it("should display both opening and closing --- delimiters", async () => {
    const frontmatterContent: "---\nnode_id: 123\ntitle: Test Node\ncolor: blue\n---\n\n# Main content here" = `---
node_id: 123
title: Test Node
color: blue
---

# Main content here`;

    editor = new CodeMirrorEditorView(container, frontmatterContent);

    // Wait for CodeMirror to render
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the text content from the editor
    const content: string = editor.getValue();

    // Check that both delimiters are present
    const openingDelim: RegExpMatchArray | null = content.match(/^---/m);
    const closingDelim: RegExpMatchArray | null = content.match(/^---$/m);

    expect(openingDelim).not.toBeNull();
    expect(closingDelim).not.toBeNull();

    // Check that content is preserved correctly
    expect(content).toContain("node_id: 123");
    expect(content).toContain("title: Test Node");
    expect(content).toContain("# Main content here");

    // Verify the structure: opening ---, content, closing ---,main content
    const lines: string[] = content.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[4]).toBe("---"); // After 3 lines of frontmatter
  });

  it("should parse frontmatter with yamlFrontmatter language support", async () => {
    const frontmatterContent: "---\nnode_id: 456\n---\nContent" = `---
node_id: 456
---
Content`;

    editor = new CodeMirrorEditorView(container, frontmatterContent);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that the editor recognizes the structure
    const content: string = editor.getValue();

    // Split and verify structure
    const lines: string[] = content.split("\n");

    // First line should be opening ---
    expect(lines[0]).toBe("---");

    // Middle should be YAML content
    expect(lines[1]).toContain("node_id:");

    // Should have closing ---
    expect(lines[2]).toBe("---");

    // Content should follow
    expect(lines[3]).toBe("Content");
  });

  it("should auto-collapse frontmatter when setValue loads NEW frontmatter", async () => {
    // Start with empty content (no frontmatter)
    editor = new CodeMirrorEditorView(container, "# Initial content");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now set content WITH frontmatter (simulates optimistic UI → actual content)
    const contentWithFrontmatter: "---\nposition:\n  x: 100\n  y: 200\n---\n# New content" = `---
position:
  x: 100
  y: 200
---
# New content`;

    editor.setValue(contentWithFrontmatter);

    // Wait for requestAnimationFrame to complete
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const value: string = editor.getValue();

    // Should still contain frontmatter (folding doesn't remove it)
    expect(value).toContain("---");
    expect(value).toContain("position:");
    expect(value).toContain("# New content");
  });

  it("should NOT auto-collapse when setValue updates existing frontmatter", async () => {
    // Start with content that already has frontmatter
    const initialContent: "---\nposition:\n  x: 50\n  y: 50\n---\n# Original" = `---
position:
  x: 50
  y: 50
---
# Original`;

    editor = new CodeMirrorEditorView(container, initialContent);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update with different frontmatter
    const updatedContent: "---\nposition:\n  x: 100\n  y: 100\n---\n# Updated" = `---
position:
  x: 100
  y: 100
---
# Updated`;

    editor.setValue(updatedContent);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const value: string = editor.getValue();

    // Should contain updated content
    expect(value).toContain("x: 100");
    expect(value).toContain("# Updated");
  });

  it("should NOT auto-collapse when setValue updates content without frontmatter", async () => {
    // Start with content without frontmatter
    editor = new CodeMirrorEditorView(container, "# First heading");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update with different content (still no frontmatter)
    editor.setValue("# Second heading");

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const value: string = editor.getValue();

    // Should contain updated content
    expect(value).toContain("# Second heading");
    expect(value).not.toContain("# First heading");
  });

  // TODO: flaky — jsdom can't lay out CodeMirror, so `cmView` is undefined here. Same
  // root cause as the skipped 'Image paste handler' describe below. Re-enable when the
  // CodeMirror suite is moved to a real-DOM runner.
  it.skip("keeps the cursor at the new end when setValue appends to an end cursor", async () => {
    editor = new CodeMirrorEditorView(container, "r");

    await new Promise((resolve) => setTimeout(resolve, 100));

    const contentElement: CodeMirrorElement | null = container.querySelector(
      ".cm-content",
    ) as CodeMirrorElement | null;
    const cmView: CMEditorView | undefined = contentElement?.cmView?.view;
    expect(cmView).toBeDefined();

    cmView!.dispatch({ selection: { anchor: cmView!.state.doc.length } });
    editor.setValue("ra");

    expect(editor.getValue()).toBe("ra");
    expect(cmView!.state.selection.main.head).toBe(2);

    cmView!.dispatch({
      changes: { from: cmView!.state.selection.main.head, insert: "n" },
      selection: { anchor: cmView!.state.selection.main.head + 1 },
      userEvent: "input.type",
    });

    expect(editor.getValue()).toBe("ran");
  });
});
describe("Autosave debounce", () => {
  let container: HTMLElement;
  let editor: CodeMirrorEditorView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (editor && !editor.isDisposed) {
      editor.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  // TODO: flaky — jsdom can't lay out CodeMirror, so `cmView` is undefined here. Same
  // root cause as the skipped 'Image paste handler' describe below.
  it.skip("emits autosave changes during continuous typing instead of starving until typing stops", async () => {
    const autosaveDelayMs: number = 150;
    const maxAutosaveWaitMs: number = 300;
    const burstDurationMs: number = 1000;
    const inputCadenceMs: number = 50;
    const emissions: string[] = [];

    editor = new CodeMirrorEditorView(container, "", {
      autosaveDelay: autosaveDelayMs,
    });
    editor.onChange((content: string) => emissions.push(content));

    const contentElement: CodeMirrorElement | null = container.querySelector(
      ".cm-content",
    ) as CodeMirrorElement | null;
    const cmView: CMEditorView | undefined = contentElement?.cmView?.view;
    expect(cmView).toBeDefined();

    vi.useFakeTimers();

    for (
      let elapsedMs: number = 0;
      elapsedMs < burstDurationMs;
      elapsedMs += inputCadenceMs
    ) {
      const docLength: number = cmView!.state.doc.length;
      cmView!.dispatch({
        changes: { from: docLength, insert: "x" },
        selection: { anchor: docLength + 1 },
        userEvent: "input.type",
      });
      await vi.advanceTimersByTimeAsync(inputCadenceMs);
    }

    expect(emissions.length).toBeGreaterThanOrEqual(
      Math.floor(burstDurationMs / maxAutosaveWaitMs) - 1,
    );
  });
});

describe("Markdown Table Rendering", () => {
  let container: HTMLElement;
  let editor: CodeMirrorEditorView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor && !editor.isDisposed) {
      editor.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it("renders markdown tables as HTML widgets while preserving other render blocks", async () => {
    const content: "# Table Fixture\n\n| Name | Value |\n| --- | --- |\n| Alpha | Beta |\n\n> Existing blockquote rendering should still work." = `# Table Fixture

| Name | Value |
| --- | --- |
| Alpha | Beta |

> Existing blockquote rendering should still work.`;

    editor = new CodeMirrorEditorView(container, content);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const renderedTable: Element | null = container.querySelector(
      ".cm-markdoc-renderBlock table",
    );
    const renderedQuote: Element | null = container.querySelector(
      ".cm-markdoc-renderBlock blockquote",
    );

    expect(renderedTable).not.toBeNull();
    expect(renderedTable?.textContent).toContain("Alpha");
    expect(renderedTable?.querySelectorAll("th")).toHaveLength(2);
    expect(renderedQuote).not.toBeNull();
    expect(renderedQuote?.textContent).toContain(
      "Existing blockquote rendering should still work.",
    );
  });

  // TODO: flaky — jsdom can't lay out CodeMirror, so `cmView` is undefined here. Same
  // root cause as the skipped 'Image paste handler' describe below.
  it.skip("shows raw table markdown when the cursor moves into the table block", async () => {
    const content: "# Table Fixture\n\n| Name | Value |\n| --- | --- |\n| Alpha | Beta |" = `# Table Fixture

| Name | Value |
| --- | --- |
| Alpha | Beta |`;

    editor = new CodeMirrorEditorView(container, content);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const contentElement: CodeMirrorElement | null = container.querySelector(
      ".cm-content",
    ) as CodeMirrorElement | null;
    const cmView: CMEditorView | undefined = contentElement?.cmView?.view;

    expect(cmView).toBeDefined();
    expect(
      container.querySelector(".cm-markdoc-renderBlock table"),
    ).not.toBeNull();

    const doc: string = cmView!.state.doc.toString();
    const tableStart: number = doc.indexOf("| Name | Value |");
    expect(tableStart).toBeGreaterThanOrEqual(0);

    cmView!.dispatch({
      selection: {
        anchor: tableStart + 2,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(container.querySelector(".cm-markdoc-renderBlock table")).toBeNull();
    expect(container.textContent).toContain("| Name | Value |");
    expect(container.textContent).toContain("| Alpha | Beta |");
  });
});

describeHasFrontmatterTests();

describe("JSON language mode", () => {
  let container: HTMLElement;
  let editor: CodeMirrorEditorView;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor && !editor.isDisposed) {
      editor.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it("should create editor in JSON mode and handle content correctly", async () => {
    const jsonContent: string = '{"key": "value", "number": 42}';

    editor = new CodeMirrorEditorView(container, jsonContent, {
      language: "json",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(editor.getValue()).toBe(jsonContent);

    // Verify setValue works
    const newJson: string = '{"updated": true}';
    editor.setValue(newJson);
    expect(editor.getValue()).toBe(newJson);
  });
});

describeImagePasteHandlerTests();
describeDarkModeThemeReactivityTests();
