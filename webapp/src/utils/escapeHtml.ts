// Single home for HTML-escaping untrusted strings before they are concatenated
// into an innerHTML string. Renderer-only: it round-trips through a detached DOM
// node's textContent -> innerHTML, so the browser's own serializer does the
// escaping (the canonical, allocation-cheap way to neutralise `<`, `&`, `>` in
// text position). Six call sites used to carry byte-identical private copies;
// they now share this one deep function.

/** Escape a string for safe interpolation into HTML *text* position. */
export function escapeHtml(text: string): string {
    const div: HTMLDivElement = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

/**
 * Escape a string for safe interpolation into a double-quoted HTML *attribute*
 * value. Extends {@link escapeHtml} by also encoding the `"` that would
 * otherwise close the attribute.
 */
export function escapeHtmlAttr(text: string): string {
    return escapeHtml(text).replace(/"/g, '&quot;')
}
