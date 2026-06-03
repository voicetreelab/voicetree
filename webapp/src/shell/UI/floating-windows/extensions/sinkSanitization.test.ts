import { describe, it, expect } from 'vitest';
import { buildVideoNotFoundNotice } from './videoRender';
import { buildMermaidErrorNotice } from './mermaidRender';

// Both notices render UNTRUSTED strings — a video file path resolved from a
// `![[...]]` wikilink, and a mermaid error message that can echo the diagram
// source. They must surface that text without ever letting it become live
// markup. We assert on the observable DOM the builders produce (black box).

const SCRIPT_PAYLOAD = '"><img src=x onerror="alert(1)"><script>alert(2)</script>';

describe('buildVideoNotFoundNotice', () => {
    it('renders a malicious file path as inert text, injecting no elements', () => {
        const node = buildVideoNotFoundNotice(SCRIPT_PAYLOAD);

        // The payload survives verbatim as text...
        expect(node.textContent).toBe(`Video not found: ${SCRIPT_PAYLOAD}`);
        // ...but produces no child elements at all — nothing was parsed as HTML.
        expect(node.querySelector('img')).toBeNull();
        expect(node.querySelector('script')).toBeNull();
        expect(node.children.length).toBe(0);
    });

    it('renders a benign path normally', () => {
        const node = buildVideoNotFoundNotice('/Users/me/clip.mp4');
        expect(node.textContent).toBe('Video not found: /Users/me/clip.mp4');
        expect(node.children.length).toBe(0);
    });
});

describe('buildMermaidErrorNotice', () => {
    it('renders a malicious error message as inert text, injecting no payload elements', () => {
        const node = buildMermaidErrorNotice(SCRIPT_PAYLOAD);

        // The heading is fixed; the untrusted message is text-only.
        expect(node.textContent).toContain('Mermaid rendering error:');
        expect(node.textContent).toContain(SCRIPT_PAYLOAD);
        expect(node.querySelector('img')).toBeNull();
        expect(node.querySelector('script')).toBeNull();
        // Only the static <strong> heading + <div> detail; no injected nodes.
        expect(node.querySelectorAll('*').length).toBe(2);
    });
});
