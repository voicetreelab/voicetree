/**
 * Pure diff utility for viewport-based node set changes.
 * Compares previous and current visible node sets,
 * returns which nodes entered and left the viewport.
 */
export function diffVisibleNodes(
    prev: ReadonlySet<string>,
    current: ReadonlySet<string>
): { readonly entered: readonly string[]; readonly left: readonly string[] } {
    const entered: readonly string[] = Array.from(current).filter(id => !prev.has(id));
    const left: readonly string[] = Array.from(prev).filter(id => !current.has(id));
    return { entered, left };
}
