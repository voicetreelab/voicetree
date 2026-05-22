import { describe, it, expect } from 'vitest';
import { getDefaultEdgeStyles } from './defaultEdgeStyles';
import type { GraphColorPalette } from './themeColors';

type StyleRule = { selector: string; style: Record<string, unknown> };

const palette: GraphColorPalette = {
    fillColor: '#3f3f3f',
    fillHighlightColor: '#525252',
    accentBorderColor: '#4b96ff',
    lineColor: '#5e5e5e',
    lineHighlightColor: '#7c7c7c',
    textColor: '#2a2a2a',
    danglingColor: '#683c3c',
    agentEdgeColor: '#100eb2',
};

function findRule(rules: StyleRule[], selector: string): StyleRule {
    const rule = rules.find((r) => r.selector === selector);
    if (!rule) throw new Error(`expected style rule for selector ${selector}`);
    return rule;
}

describe('§9.3 synthetic-edge aggregated count surface', () => {
    const rules: StyleRule[] = getDefaultEdgeStyles(palette, 'sans-serif', false);

    it('renders ×N label on edges with edgeCount data', () => {
        const rule = findRule(rules, 'edge[edgeCount]');
        const labelFn = rule.style['label'] as (ele: { data: (k: string) => unknown }) => string;
        expect(typeof labelFn).toBe('function');

        const edge = { data: (k: string) => (k === 'edgeCount' ? 7 : undefined) };
        expect(labelFn(edge)).toBe('×7');
    });

    it('keeps width/arrow/opacity scaled by edgeCount alongside the label', () => {
        const rule = findRule(rules, 'edge[edgeCount]');
        expect(rule.style['width']).toBe('mapData(edgeCount, 1, 50, 2.5, 12.5)');
        expect(rule.style['arrow-scale']).toBe('mapData(edgeCount, 1, 50, 0.735, 3.15)');
        expect(rule.style['line-opacity']).toBe('mapData(edgeCount, 1, 10, 0.35, 0.6)');
    });

    it('does not bind the count label to the relationship-label selector', () => {
        // Single-edge synthetics carry the original relationship label (no edgeCount),
        // and the `edge[label]` rule must keep mapping label -> data(label), unaffected
        // by the count surface.
        const labelRule = findRule(rules, 'edge[label]');
        expect(labelRule.style['label']).toBe('data(label)');
    });
});
