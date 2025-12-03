import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveEnvVars } from './types';

describe('resolveEnvVars', () => {
  it('should pass through string values unchanged', () => {
    const input = {
      FOO: 'bar',
      BAZ: 'qux',
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('should randomly select from array values', () => {
    const input = {
      AGENT_NAME: ['TIMI', 'XAN', 'JAS'] as const,
    };

    // Run multiple times to verify it picks from the array
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = resolveEnvVars(input);
      results.add(result.AGENT_NAME);
      expect(['TIMI', 'XAN', 'JAS']).toContain(result.AGENT_NAME);
    }

    // With 100 iterations, we should see more than 1 unique value (probabilistically)
    expect(results.size).toBeGreaterThan(1);
  });

  it('should handle mixed string and array values', () => {
    const input = {
      STATIC: 'always-this',
      RANDOM: ['A', 'B'] as const,
    };

    const result = resolveEnvVars(input);
    expect(result.STATIC).toBe('always-this');
    expect(['A', 'B']).toContain(result.RANDOM);
  });

  it('should handle empty object', () => {
    const result = resolveEnvVars({});
    expect(result).toEqual({});
  });

  it('should handle single-element arrays', () => {
    const input = {
      SINGLE: ['only-one'] as const,
    };
    const result = resolveEnvVars(input);
    expect(result.SINGLE).toBe('only-one');
  });
});
