import {Decoration, WidgetType, EditorView, type DecorationSet} from '@codemirror/view';
import {RangeSet, StateField, type EditorState, type Range} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import type { RenderResult } from 'mermaid';

// Lazy-loaded mermaid module (65MB!) - only loaded when first diagram renders
let mermaidModule: typeof import('mermaid') | null = null;

async function getMermaid(): Promise<typeof import('mermaid')['default']> {
    if (!mermaidModule) {
        mermaidModule = await import('mermaid');
        mermaidModule.default.initialize({
            startOnLoad: false,
            theme: 'default',
            // 'strict' (not 'loose'): diagram source comes from node markdown, which is
            // UNTRUSTED graph/file content. 'loose' enables click-handler binding and
            // raw HTML in labels — an XSS vector when an attacker authors the diagram.
            // 'strict' makes mermaid HTML-encode label text and disable click callbacks,
            // and its internal DOMPurify pass still sanitizes the emitted SVG. Normal
            // flowcharts/sequence diagrams render unchanged; only raw-HTML labels and
            // click interactions (which the app does not use) are dropped.
            securityLevel: 'strict',
            suppressErrorRendering: true,
        });
    }
    return mermaidModule.default;
}

/**
 * Widget that renders Mermaid diagrams as SVG
 * Similar to RenderBlockWidget from codemirror-rich-markdoc
 */
class MermaidBlockWidget extends WidgetType {
    readonly source: string;
    // Sanitized SVG markup from mermaid (safe to innerHTML — mermaid runs DOMPurify
    // on its output). Mutually exclusive with `errorMessage`.
    private svg: string | null = null;
    // Plain-text error from a failed render. Rendered via textContent, never innerHTML,
    // because mermaid error messages can echo the (untrusted) diagram source.
    private errorMessage: string | null = null;
    private renderPromise: Promise<void> | null = null;

    constructor(source: string) {
        super();
        this.source = source;

        // Extract just the diagram source (remove ```mermaid and ```)
        const lines: string[] = source.split('\n');
        const diagramSource: string = lines.slice(1, -1).join('\n');

        // Start async rendering
        this.renderPromise = this.renderMermaid(diagramSource);
    }

    private async renderMermaid(diagramSource: string): Promise<void> {
        try {
            const mermaid: typeof import('mermaid')['default'] = await getMermaid();
            const id: string = 'mermaid-' + Math.random().toString(36).substring(2, 11);
            const result: RenderResult = await mermaid.render(id, diagramSource);
            this.svg = result.svg;
        } catch (error) {
            console.error('Mermaid rendering error:', error);
            this.errorMessage = error instanceof Error ? error.message : 'Unknown error';
        }
    }

    eq(widget: MermaidBlockWidget): boolean {
        return widget.source === this.source;
    }

    /** Render the current state (svg / error / still-loading) into the container. */
    private paint(container: HTMLElement): void {
        if (this.svg !== null) {
            container.innerHTML = this.svg;
            return;
        }
        if (this.errorMessage !== null) {
            container.replaceChildren(buildMermaidErrorNotice(this.errorMessage));
            return;
        }
        container.replaceChildren(buildMermaidLoadingNotice());
    }

    toDOM(): HTMLElement {
        const container: HTMLDivElement = document.createElement('div');
        container.setAttribute('contenteditable', 'false');
        container.className = 'cm-mermaid-render';

        this.paint(container);
        // If still loading at first paint, repaint once the render settles.
        if (this.svg === null && this.errorMessage === null) {
            void this.renderPromise?.then(() => this.paint(container));
        }

        return container;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Build the "rendering error" notice as a DOM node. The message is attached via
 * textContent so an untrusted diagram source echoed back in a mermaid error can
 * never inject markup. Exported for black-box testing.
 */
export function buildMermaidErrorNotice(message: string): HTMLElement {
    const wrapper: HTMLDivElement = document.createElement('div');
    wrapper.style.color = 'red';
    wrapper.style.padding = '10px';

    const heading: HTMLElement = document.createElement('strong');
    heading.textContent = 'Mermaid rendering error:';

    const detail: HTMLDivElement = document.createElement('div');
    detail.textContent = message;

    wrapper.append(heading, detail);
    return wrapper;
}

function buildMermaidLoadingNotice(): HTMLElement {
    const notice: HTMLDivElement = document.createElement('div');
    notice.style.padding = '10px';
    notice.style.color = '#666';
    notice.textContent = 'Rendering diagram...';
    return notice;
}

/**
 * Find and replace Mermaid code blocks with rendered widgets
 * Similar to replaceBlocks from codemirror-rich-markdoc
 */
function replaceMermaidBlocks(state: EditorState, from?: number, to?: number): Range<Decoration>[] {
    const decorations: Range<Decoration>[] = [];
    const [cursor] = state.selection.ranges;

    syntaxTree(state).iterate({
        from,
        to,
        enter(node) {
            // Only process FencedCode nodes
            if (node.name !== 'FencedCode') {
                return;
            }

            // Get the full text of the code block
            const text: string = state.doc.sliceString(node.from, node.to);

            // Check if it's a mermaid code block
            if (!text.match(/^```mermaid/i)) {
                return;
            }

            // Don't render if cursor is inside the block
            // This allows editing when user clicks on the diagram
            if (cursor.from >= node.from && cursor.to <= node.to) {
                return;
            }

            // Create decoration to replace the code block with rendered widget
            const decoration: Decoration = Decoration.replace({
                widget: new MermaidBlockWidget(text),
                block: true,
            });

            decorations.push(decoration.range(node.from, node.to));
        }
    });

    return decorations;
}

/**
 * CodeMirror StateField extension for Mermaid diagram rendering
 * Follows the same pattern as renderBlock from codemirror-rich-markdoc
 */
export function mermaidRender(): StateField<DecorationSet> {
    return StateField.define<DecorationSet>({
        create(state) {
            return RangeSet.of(replaceMermaidBlocks(state), true);
        },

        update(_decorations, transaction) {
            // Rebuild decorations on document changes
            return RangeSet.of(replaceMermaidBlocks(transaction.state), true);
        },

        provide(field) {
            return EditorView.decorations.from(field);
        },
    });
}
