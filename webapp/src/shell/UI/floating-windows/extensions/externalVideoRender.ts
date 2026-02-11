import {Decoration, WidgetType, EditorView, type DecorationSet} from '@codemirror/view';
import {RangeSet, StateField, type EditorState, type Range} from '@codemirror/state';

/**
 * URL patterns for supported video platforms.
 * Each pattern extracts the video ID and provides an embed URL constructor.
 */
const VIDEO_URL_PATTERNS: Array<{
    regex: RegExp;
    embed: (id: string) => string;
}> = [
    { regex: /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/, embed: (id) => `https://www.youtube.com/embed/${id}` },
    { regex: /^(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]+)/, embed: (id) => `https://www.youtube.com/embed/${id}` },
    { regex: /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/, embed: (id) => `https://player.vimeo.com/video/${id}` },
    { regex: /^(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([a-zA-Z0-9]+)/, embed: (id) => `https://www.loom.com/embed/${id}` },
];

/**
 * Try to match a line of text against video URL patterns.
 * Returns the embed URL if matched, null otherwise.
 */
function matchVideoUrl(text: string): string | null {
    const trimmed: string = text.trim();
    if (!trimmed) return null;

    for (const pattern of VIDEO_URL_PATTERNS) {
        const match: RegExpMatchArray | null = trimmed.match(pattern.regex);
        if (match?.[1]) {
            return pattern.embed(match[1]);
        }
    }
    return null;
}

/**
 * Widget that renders an external video embed as an iframe.
 */
class ExternalVideoWidget extends WidgetType {
    readonly embedUrl: string;

    constructor(embedUrl: string) {
        super();
        this.embedUrl = embedUrl;
    }

    eq(widget: ExternalVideoWidget): boolean {
        return widget.embedUrl === this.embedUrl;
    }

    toDOM(): HTMLElement {
        const container: HTMLDivElement = document.createElement('div');
        container.setAttribute('contenteditable', 'false');
        container.className = 'cm-external-video-render';

        const iframe: HTMLIFrameElement = document.createElement('iframe');
        iframe.src = this.embedUrl;
        iframe.width = '560';
        iframe.height = '315';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-popups');
        iframe.style.border = 'none';
        iframe.style.borderRadius = '8px';

        container.appendChild(iframe);
        return container;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Find standalone video URLs and replace them with embedded player widgets.
 * A "standalone" URL is a line that contains only the URL (possibly with whitespace).
 * When the cursor is on the line, the raw URL text is shown for editing.
 */
function replaceExternalVideoBlocks(state: EditorState): Range<Decoration>[] {
    const decorations: Range<Decoration>[] = [];
    const [cursor] = state.selection.ranges;

    for (let i: number = 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i);
        const embedUrl: string | null = matchVideoUrl(line.text);

        if (!embedUrl) continue;

        // Don't render if cursor is on this line — allow editing
        if (cursor.from >= line.from && cursor.from <= line.to) continue;

        const decoration: Decoration = Decoration.replace({
            widget: new ExternalVideoWidget(embedUrl),
            block: true,
        });

        decorations.push(decoration.range(line.from, line.to));
    }

    return decorations;
}

/**
 * CodeMirror StateField extension for external video URL rendering.
 * Follows the same pattern as mermaidRender.
 */
export function externalVideoRender(): StateField<DecorationSet> {
    return StateField.define<DecorationSet>({
        create(state) {
            return RangeSet.of(replaceExternalVideoBlocks(state), true);
        },

        update(_decorations, transaction) {
            return RangeSet.of(replaceExternalVideoBlocks(transaction.state), true);
        },

        provide(field) {
            return EditorView.decorations.from(field);
        },
    });
}
