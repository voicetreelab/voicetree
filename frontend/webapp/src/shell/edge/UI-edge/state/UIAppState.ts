export const vanillaFloatingWindowInstances = new Map<string, { dispose: () => void }>();

/**
 * Get a vanilla instance by window ID (for testing)
 * @internal - Only for test usage
 */
export function getVanillaInstance(windowId: string): { dispose: () => void } | undefined {
    return vanillaFloatingWindowInstances.get(windowId);
}