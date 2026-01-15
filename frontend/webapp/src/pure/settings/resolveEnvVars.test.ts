import { describe, it, expect } from 'vitest';
import { type EnvVarValue } from './types';
import {expandEnvVarsInValues, resolveEnvVars} from "@/pure/settings/resolve-environment-variable";

describe('resolveEnvVars', () => {
  it('should pass through simple string values', () => {
    const input: Record<string, EnvVarValue> = {
      FOO: 'bar',
      BAZ: 'qux',
    };
    const result: Record<string, string> = resolveEnvVars(input);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('should normalize whitespace (collapse newlines to single spaces)', () => {
    const input: Record<string, EnvVarValue> = {
      PROMPT: `First line

Second line
Third line`,
    };
    const result: Record<string, string> = resolveEnvVars(input);
    expect(result.PROMPT).toBe('First line Second line Third line');
  });

  it('should randomly select from array values', () => {
    const input: Record<string, EnvVarValue> = {
      AGENT_NAME: ['TIMI', 'XAN', 'JAS'] as const,
    };

    // Run multiple times to verify it picks from the array
    const results: Set<string> = Array.from({ length: 100 }).reduce(
      (acc: Set<string>) => {
        const result: Record<string, string> = resolveEnvVars(input);
        acc.add(result.AGENT_NAME);
        expect(['TIMI', 'XAN', 'JAS']).toContain(result.AGENT_NAME);
        return acc;
      },
      new Set<string>()
    );

    // With 100 iterations, we should see more than 1 unique value (probabilistically)
    expect(results.size).toBeGreaterThan(1);
  });

  it('should handle mixed string and array values', () => {
    const input: Record<string, EnvVarValue> = {
      STATIC: 'always-this',
      RANDOM: ['A', 'B'] as const,
    };

    const result: Record<string, string> = resolveEnvVars(input);
    expect(result.STATIC).toBe('always-this');
    expect(['A', 'B']).toContain(result.RANDOM);
  });

  it('should handle empty object', () => {
    const result: Record<string, string> = resolveEnvVars({});
    expect(result).toEqual({});
  });

  it('should handle single-element arrays', () => {
    const input: Record<string, EnvVarValue> = {
      SINGLE: ['only-one'] as const,
    };
    const result: Record<string, string> = resolveEnvVars(input);
    expect(result.SINGLE).toBe('only-one');
  });
});

describe('expandEnvVarsInValues', () => {
  it('should expand $VAR_NAME references within values', () => {
    const input: Record<string, string> = {
      CONTEXT_NODE_CONTENT: 'This is the content',
      AGENT_PROMPT: 'Task: $CONTEXT_NODE_CONTENT',
    };
    const result: Record<string, string> = expandEnvVarsInValues(input);
    expect(result.AGENT_PROMPT).toBe('Task: This is the content');
    expect(result.CONTEXT_NODE_CONTENT).toBe('This is the content');
  });

  it('should expand multiple references in one value', () => {
    const input: Record<string, string> = {
      FOO: 'hello',
      BAR: 'world',
      COMBINED: '$FOO $BAR!',
    };
    const result: Record<string, string> = expandEnvVarsInValues(input);
    expect(result.COMBINED).toBe('hello world!');
  });

  it('should leave undefined references as-is', () => {
    const input: Record<string, string> = {
      PROMPT: 'Use $UNDEFINED_VAR here',
    };
    const result: Record<string, string> = expandEnvVarsInValues(input);
    expect(result.PROMPT).toBe('Use $UNDEFINED_VAR here');
  });

  it('should handle values without any references', () => {
    const input: Record<string, string> = {
      PLAIN: 'no references here',
    };
    const result: Record<string, string> = expandEnvVarsInValues(input);
    expect(result.PLAIN).toBe('no references here');
  });

  it('should handle empty object', () => {
    const result: Record<string, string> = expandEnvVarsInValues({});
    expect(result).toEqual({});
  });

  it('should not expand lowercase or invalid var names', () => {
    const input: Record<string, string> = {
      lowercase: 'value',
      TEST: 'Should not match $lowercase or $123INVALID',
    };
    const result: Record<string, string> = expandEnvVarsInValues(input);
    expect(result.TEST).toBe('Should not match $lowercase or $123INVALID');
  });
});
