import { Decoration, WidgetType, EditorView, type DecorationSet } from '@codemirror/view';
import { RangeSet, StateField, type EditorState, type Range, type Line } from '@codemirror/state';
import type { Core, NodeSingular } from 'cytoscape';
import type {} from '@/shell/electron';
import { VIDEO_EXTENSIONS } from '@/pure/graph/isVideoNode';

function getCytoscapeInstance(): Core | undefined {
    return (window as unknown as { cytoscapeInstance?: Core }).cytoscapeInstance;
}

/**
 * Cached watched folder path (project root) for resolving relative video references.
 * Populated asynchronously on module load via IPC.
 */
let cachedWatchedFolder: string | null = null;

function initWatchedFolderCache(): void {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.main?.getWatchStatus) return;
    void electronAPI.main.getWatchStatus().then(status => {
        cachedWatchedFolder = status.directory ?? null;
    });
}

initWatchedFolderCache();

/**
 * Regex to match image-style wikilinks: ![[filename]]
 */
const IMAGE_WIKILINK_REGEX: RegExp = /!\[\[([^\]]+)\]\]/g;

/**
 * Check if a filename has a video extension
 */
function isVideoFilename(filename: string): boolean {
    const lower: string = filename.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Resolve a wikilink video reference to an absolute file path.
 * 1. Absolute paths (starting with /) are returned directly.
 * 2. Tries graph lookup (exact match, then suffix match).
 * 3. Falls back to resolving relative to the watchedFolder project root.
 */
function resolveVideoPath(linkText: string): string | null {
    // Absolute paths: use directly
    if (linkText.startsWith('/')) {
        return linkText;
    }

    const cy: Core | undefined = getCytoscapeInstance();
    if (cy) {
        // Try exact match
        const exactNode = cy.getElementById(linkText);
        if (!exactNode.empty()) {
            return exactNode.id();
        }

        // Try suffix match against all nodes
        const lowerLink: string = linkText.toLowerCase();
        let bestMatch: string | null = null;
        cy.nodes().forEach((n: NodeSingular) => {
            if (n.data('isShadowNode') || n.data('isContextNode')) return;
            if (n.id().toLowerCase().endsWith(lowerLink)) {
                bestMatch = n.id();
            }
        });
        if (bestMatch) return bestMatch;
    }

    // Fall back to resolving relative to project root (watchedFolder)
    if (cachedWatchedFolder && linkText) {
        return `${cachedWatchedFolder}/${linkText}`;
    }

    return null;
}

/**
 * Widget that renders a local video file as an inline HTML5 video player.
 */
class VideoBlockWidget extends WidgetType {
    readonly filePath: string;

    constructor(filePath: string) {
        super();
        this.filePath = filePath;
    }

    eq(widget: VideoBlockWidget): boolean {
        return widget.filePath === this.filePath;
    }

    toDOM(): HTMLElement {
        const container: HTMLDivElement = document.createElement('div');
        container.setAttribute('contenteditable', 'false');
        container.className = 'cm-video-render';

        const video: HTMLVideoElement = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        video.style.maxWidth = '100%';
        video.style.borderRadius = '8px';
        video.style.display = 'block';
        video.src = `file://${this.filePath}`;

        video.addEventListener('error', (): void => {
            container.innerHTML = `<div style="padding: 10px; color: #888; font-size: 13px;">Video not found: ${this.filePath}</div>`;
        });

        container.appendChild(video);
        return container;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/**
 * Find image-style wikilinks referencing video files and replace with player widgets.
 * Pattern: ![[video.mp4]]
 * When cursor is on the line, raw markdown is shown for editing.
 */
function replaceVideoBlocks(state: EditorState): Range<Decoration>[] {
    const decorations: Range<Decoration>[] = [];
    const [cursor] = state.selection.ranges;

    for (let i: number = 1; i <= state.doc.lines; i++) {
        const line: Line = state.doc.line(i);
        const lineText: string = line.text;

        let match: RegExpExecArray | null;
        IMAGE_WIKILINK_REGEX.lastIndex = 0;

        while ((match = IMAGE_WIKILINK_REGEX.exec(lineText)) !== null) {
            const linkText: string = match[1];

            // Only process video files
            if (!isVideoFilename(linkText)) continue;

            const matchStart: number = line.from + match.index;
            const matchEnd: number = matchStart + match[0].length;

            // Don't render if cursor is on this line — allow editing
            if (cursor.from >= line.from && cursor.from <= line.to) continue;

            // Resolve to absolute path
            const resolvedPath: string | null = resolveVideoPath(linkText);
            if (!resolvedPath) continue;

            const decoration: Decoration = Decoration.replace({
                widget: new VideoBlockWidget(resolvedPath),
                block: true,
            });

            decorations.push(decoration.range(matchStart, matchEnd));
        }
    }

    return decorations;
}

/**
 * CodeMirror extension for inline local video rendering.
 * Detects ![[video.mp4]] wikilinks and renders HTML5 video players.
 * Follows the same StateField pattern as mermaidRender.
 *
 * Path resolution:
 * - Absolute paths (![[/path/to/video.mp4]]) are used directly
 * - Relative paths (![[video.mp4]]) resolve via graph lookup, then watchedFolder root
 */
export function videoRender(): StateField<DecorationSet> {
    return StateField.define<DecorationSet>({
        create(state) {
            return RangeSet.of(replaceVideoBlocks(state), true);
        },

        update(_decorations, transaction) {
            return RangeSet.of(replaceVideoBlocks(transaction.state), true);
        },

        provide(field) {
            return EditorView.decorations.from(field);
        },
    });
}
