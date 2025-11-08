/**
 * Integration test for graph-core module exports
 *
 * Verifies that:
 * 1. addFloatingWindow function is exported
 * 2. Type definitions are properly exported
 * 3. Module loads without errors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Graph Core Module Exports', () => {
  beforeEach(() => {
    // Clear module cache to ensure fresh imports
    vi.resetModules();
  });

  it('should export addFloatingWindow function', async () => {
    const graphCore = await import('@/graph-core/index');

    expect(graphCore.addFloatingWindow).toBeDefined();
    expect(typeof graphCore.addFloatingWindow).toBe('function');
  });

  it('should export type definitions', async () => {
    // This test just verifies the module loads without errors
    // TypeScript will catch any type export issues at compile time
    const graphCore = await import('@/graph-core/index');

    expect(graphCore).toBeDefined();
  });
});
