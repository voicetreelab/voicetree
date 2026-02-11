/**
 * Compute display text for the worktree indicator.
 * If the worktree name (stripped of wt- prefix and random suffix) is essentially
 * the same as the terminal title, show just the branch symbol to avoid duplication.
 * Otherwise, show the worktree's display name (without wt- prefix).
 */
export function worktreeDisplayName(worktreeName: string, title: string): string {
    // Strip "wt-" prefix
    const withoutPrefix: string = worktreeName.startsWith('wt-')
        ? worktreeName.slice(3)
        : worktreeName;
    // Strip 3-char random suffix (e.g., "-a3k")
    const withoutSuffix: string = withoutPrefix.replace(/-[a-z0-9]{3}$/, '');

    // Normalize for comparison: lowercase, only alphanumeric
    const normalize: (s: string) => string = (s: string): string =>
        s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const normalizedWt: string = normalize(withoutSuffix);
    const normalizedTitle: string = normalize(title);

    // If the worktree name is essentially contained in the title (or vice versa), they're redundant
    if (normalizedTitle.includes(normalizedWt) || normalizedWt.includes(normalizedTitle)) {
        return '\u2387';
    }

    // Show the display name (stripped prefix, keep suffix for uniqueness)
    return `\u2387 ${withoutPrefix}`;
}
