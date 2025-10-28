import { describe, it, expect } from 'vitest';
import { StyleService } from '@/graph-core/services/StyleService';

describe('StyleService', () => {
  it('should generate correct mapData strings for node sizing', () => {
    const styleService = new StyleService();
    const stylesheet = styleService.getDefaultStylesheet();

    // Find the node[degree] selector
    const degreeRule = stylesheet.find(rule => rule.selector === 'node[degree]');

    expect(degreeRule).toBeDefined();
    console.log('node[degree] rule:', JSON.stringify(degreeRule, null, 2));

    // Check that the style values are correctly formed
    if (degreeRule && 'style' in degreeRule) {
      const style = degreeRule.style as Record<string, string>;
      console.log('width style:', style.width);
      console.log('height style:', style.height);
      console.log('font-size style:', style['font-size']);

      // Verify the mapData strings are correct
      expect(style.width).toMatch(/^mapData\(degree, \d+, \d+, \d+, \d+\)$/);
      expect(style.height).toMatch(/^mapData\(degree, \d+, \d+, \d+, \d+\)$/);
    }
  });
});
