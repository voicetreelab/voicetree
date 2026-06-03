import { describe, expect, it } from 'vitest';
import { parseLayoutConfig } from './autoLayoutConfig';

describe('parseLayoutConfig', () => {
  it('accepts all supported layout engine ids', () => {
    expect(parseLayoutConfig('{"engine":"forceatlas2"}').engine).toBe('forceatlas2');
    expect(parseLayoutConfig('{"engine":"combocombined"}').engine).toBe('combocombined');
    expect(parseLayoutConfig('{"engine":"mindmap"}').engine).toBe('mindmap');
    expect(parseLayoutConfig('{"engine":"pivotmds"}').engine).toBe('pivotmds');
    expect(parseLayoutConfig('{"engine":"webcola"}').engine).toBe('webcola');
  });

  it('maps legacy cola config to the webcola backend', () => {
    expect(parseLayoutConfig('{"engine":"cola"}').engine).toBe('webcola');
  });

  it('falls back to forceatlas2 for invalid engine ids', () => {
    expect(parseLayoutConfig('{"engine":"unknown"}').engine).toBe('forceatlas2');
  });

  it('reads ForceAtlas2 tuning knobs from the config JSON', () => {
    const { forceatlas2 } = parseLayoutConfig(
      '{"engine":"forceatlas2","kr":50,"kg":2,"ks":0.3,"maxIteration":400,"spacing":80,"edgeLength":450}',
    );
    expect(forceatlas2).toEqual({ kr: 50, kg: 2, ks: 0.3, maxIteration: 400, spacing: 80, edgeLength: 450 });
  });

  it('defaults each ForceAtlas2 knob independently when absent or non-numeric', () => {
    const { forceatlas2 } = parseLayoutConfig('{"engine":"forceatlas2","kr":50,"spacing":"wide"}');
    expect(forceatlas2).toEqual({ kr: 50, kg: 1, ks: 0.1, maxIteration: 0, spacing: 20, edgeLength: 0 });
  });

  it('supplies default ForceAtlas2 knobs when the JSON is missing or invalid', () => {
    const defaults = { kr: 5, kg: 1, ks: 0.1, maxIteration: 0, spacing: 20, edgeLength: 0 };
    expect(parseLayoutConfig(undefined).forceatlas2).toEqual(defaults);
    expect(parseLayoutConfig('not json').forceatlas2).toEqual(defaults);
  });

  it('reads PivotMDS tuning knobs from the config JSON', () => {
    const { pivotmds } = parseLayoutConfig(
      '{"engine":"pivotmds","pivotCount":12,"spacing":55,"edgeLength":420}',
    );
    expect(pivotmds).toEqual({ pivotCount: 12, spacing: 55, edgeLength: 420 });
  });
});
