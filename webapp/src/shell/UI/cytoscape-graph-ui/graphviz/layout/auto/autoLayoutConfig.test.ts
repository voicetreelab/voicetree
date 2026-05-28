import { describe, expect, it } from 'vitest';
import { parseLayoutConfig } from './autoLayoutConfig';

describe('parseLayoutConfig', () => {
  it('accepts all supported layout engine ids', () => {
    expect(parseLayoutConfig('{"engine":"forceatlas2"}').engine).toBe('forceatlas2');
    expect(parseLayoutConfig('{"engine":"combocombined"}').engine).toBe('combocombined');
    expect(parseLayoutConfig('{"engine":"mindmap"}').engine).toBe('mindmap');
    expect(parseLayoutConfig('{"engine":"webcola"}').engine).toBe('webcola');
  });

  it('maps legacy cola config to the webcola backend', () => {
    expect(parseLayoutConfig('{"engine":"cola"}').engine).toBe('webcola');
  });

  it('falls back to forceatlas2 for invalid engine ids', () => {
    expect(parseLayoutConfig('{"engine":"unknown"}').engine).toBe('forceatlas2');
  });
});
