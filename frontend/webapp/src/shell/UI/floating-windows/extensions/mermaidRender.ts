import {Decoration, WidgetType, EditorView, type DecorationSet} from '@codemirror/view';
import {RangeSet, StateField, type EditorState, type Range} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';
import mermaid from 'mermaid';
import type { RenderResult } from 'mermaid';

// Initialize Mermaid with default config
mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    suppressErrorRendering: true, // annoying html
});

/**
 * Widget that renders Mermaid diagrams as SVG
 * Similar to RenderBlockWidget from codemirror-rich-markdoc
 */
class MermaidBlockWidget extends WidgetType {
    readonly source: string;
    private rendered: string | null = null;
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
            const id: string = 'mermaid-' + Math.random().toString(36).substring(2, 11);
            const result: RenderResult = await mermaid.render(id, diagramSource);
            this.rendered = result.svg;
        } catch (error) {
            console.error('Mermaid rendering error:', error);
            this.rendered = `<div style="color: red; padding: 10px;">
        <strong>Mermaid rendering error:</strong><br/>
        ${error instanceof Error ? error.message : 'Unknown error'}
      </div>`;
        }
    }

    eq(widget: MermaidBlockWidget): boolean {
        return widget.source === this.source;
    }

    toDOM(): HTMLElement {
        const container: HTMLDivElement = document.createElement('div');
        container.setAttribute('contenteditable', 'false');
        container.className = 'cm-mermaid-render';

        if (this.rendered) {
            // Already rendered
            container.innerHTML = this.rendered;
        } else {
            // Still rendering - show loading indicator
            container.innerHTML = '<div style="padding: 10px; color: #666;">Rendering diagram...</div>';

            // Update when rendering completes
            void this.renderPromise?.then(() => {
                if (this.rendered) {
                    container.innerHTML = this.rendered;
                }
            });
        }

        return container;
    }

    ignoreEvent(): boolean {
        return false;
    }
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
