import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
} from "vitest";

import { CodeMirrorEditorView } from "@/shell/UI/floating-windows/editors/CodeMirrorEditorView";

export function describeImagePasteHandlerTests(): void {
  // TODO: flaky — jsdom CodeMirror DOM measurement throws unhandled errors after test completion
  describe.skip("Image paste handler", () => {
    let container: HTMLElement;
    let editor: CodeMirrorEditorView;
    let mockSaveClipboardImage: ReturnType<typeof vi.fn>;

    // Polyfill ClipboardEvent for JSDOM (which doesn't have it natively)
    beforeAll(() => {
      if (typeof ClipboardEvent === "undefined") {
        (global as Record<string, unknown>).ClipboardEvent =
          class ClipboardEvent extends Event {
            public clipboardData: DataTransfer | null;
            constructor(
              type: string,
              options?: {
                clipboardData?: DataTransfer;
                bubbles?: boolean;
                cancelable?: boolean;
              },
            ) {
              super(type, {
                bubbles: options?.bubbles,
                cancelable: options?.cancelable,
              });
              this.clipboardData = options?.clipboardData ?? null;
            }
          };
      }
    });

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);

      // Setup mock for hostAPI.main.saveClipboardImage
      mockSaveClipboardImage = vi.fn();
      window.hostAPI = {
        main: {
          saveClipboardImage: mockSaveClipboardImage,
        },
      } as unknown as typeof window.hostAPI;
    });

    afterEach(() => {
      if (editor && !editor.isDisposed) {
        editor.dispose();
      }
      if (container.parentNode) {
        document.body.removeChild(container);
      }
      // Cleanup mock
      window.hostAPI = undefined;
    });

    /**
     * Helper to create a mock FileList-like object (JSDOM doesn't allow new FileList())
     */
    function createEmptyFileList(): FileList {
      const fileList: { length: number; item: () => null } = {
        length: 0,
        item: () => null,
      };
      return fileList as unknown as FileList;
    }

    /**
     * Helper to create a mock ClipboardEvent with image data
     */
    function createImagePasteEvent(): ClipboardEvent {
      const dataTransferItem: DataTransferItem = {
        kind: "file",
        type: "image/png",
        getAsFile: () => new File([], "image.png", { type: "image/png" }),
        getAsString: () => {},
        webkitGetAsEntry: () => null,
      };

      const clipboardData: DataTransfer = {
        items: [dataTransferItem] as unknown as DataTransferItemList,
        types: ["Files"],
        getData: () => "",
        setData: () => {},
        clearData: () => {},
        files: createEmptyFileList(),
        dropEffect: "none",
        effectAllowed: "none",
        setDragImage: () => {},
      };

      return new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
    }

    /**
     * Helper to create a mock ClipboardEvent with text data only (no image)
     */
    function createTextPasteEvent(): ClipboardEvent {
      const dataTransferItem: DataTransferItem = {
        kind: "string",
        type: "text/plain",
        getAsFile: () => null,
        getAsString: (callback) => callback?.("pasted text"),
        webkitGetAsEntry: () => null,
      };

      const clipboardData: DataTransfer = {
        items: [dataTransferItem] as unknown as DataTransferItemList,
        types: ["text/plain"],
        getData: () => "pasted text",
        setData: () => {},
        clearData: () => {},
        files: createEmptyFileList(),
        dropEffect: "none",
        effectAllowed: "none",
        setDragImage: () => {},
      };

      return new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
    }

    it("should call saveClipboardImage and insert wikilink when pasting image", async () => {
      const nodeId: string = "/path/to/notes/my-note.md";
      editor = new CodeMirrorEditorView(container, "# Test content", {
        nodeId,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Mock successful image save
      mockSaveClipboardImage.mockResolvedValue("pasted-1705123456789.png");

      // Get the CodeMirror content element to dispatch paste event
      const cmContent: Element | null = container.querySelector(".cm-content");
      expect(cmContent).not.toBeNull();

      // Dispatch paste event with image
      const pasteEvent: ClipboardEvent = createImagePasteEvent();
      cmContent!.dispatchEvent(pasteEvent);

      // Wait for async IPC call to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify IPC was called with correct nodeId
      expect(mockSaveClipboardImage).toHaveBeenCalledWith(nodeId);

      // Verify wikilink was inserted
      const content: string = editor.getValue();
      expect(content).toContain("![[pasted-1705123456789.png]]");
    });

    it("should not call saveClipboardImage when pasting without nodeId configured", async () => {
      // Create editor WITHOUT nodeId
      editor = new CodeMirrorEditorView(container, "# Test content");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cmContent: Element | null = container.querySelector(".cm-content");
      expect(cmContent).not.toBeNull();

      // Dispatch paste event with image
      const pasteEvent: ClipboardEvent = createImagePasteEvent();
      cmContent!.dispatchEvent(pasteEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify IPC was NOT called
      expect(mockSaveClipboardImage).not.toHaveBeenCalled();
    });

    it("should not call saveClipboardImage when pasting text (no image)", async () => {
      const nodeId: string = "/path/to/notes/my-note.md";
      editor = new CodeMirrorEditorView(container, "# Test content", {
        nodeId,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cmContent: Element | null = container.querySelector(".cm-content");
      expect(cmContent).not.toBeNull();

      // Dispatch paste event with text only
      const pasteEvent: ClipboardEvent = createTextPasteEvent();
      cmContent!.dispatchEvent(pasteEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify IPC was NOT called for text paste
      expect(mockSaveClipboardImage).not.toHaveBeenCalled();
    });

    it("should not insert wikilink when saveClipboardImage returns null", async () => {
      const nodeId: string = "/path/to/notes/my-note.md";
      const initialContent: string = "# Test content";
      editor = new CodeMirrorEditorView(container, initialContent, { nodeId });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Mock no image in clipboard (returns null)
      mockSaveClipboardImage.mockResolvedValue(null);

      const cmContent: Element | null = container.querySelector(".cm-content");
      expect(cmContent).not.toBeNull();

      // Dispatch paste event
      const pasteEvent: ClipboardEvent = createImagePasteEvent();
      cmContent!.dispatchEvent(pasteEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify content unchanged (no wikilink inserted)
      const content: string = editor.getValue();
      expect(content).toBe(initialContent);
      expect(content).not.toContain("![[");
    });
  });
}
