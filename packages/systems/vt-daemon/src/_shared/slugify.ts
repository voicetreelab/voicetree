/**
 * Slugify free text into a filesystem/url-safe lowercase token: spaces → `-`,
 * non-alphanumerics dropped, runs of `-` collapsed, leading/trailing `-` trimmed.
 * Shared by progress-node filename generation and the folder copy-node operation.
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}
