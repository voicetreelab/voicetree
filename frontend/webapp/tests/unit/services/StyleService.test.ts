import { describe, it, expect, beforeEach } from 'vitest';
import { StyleService } from '@/graph-core/services/StyleService';

describe('StyleService', () => {
  let styleService: StyleService;

  beforeEach(() => {
    styleService = new StyleService();
  });

  describe('getDefaultStylesheet', () => {
    it('should return an array of stylesheet rules', () => {
      const stylesheet = styleService.getDefaultStylesheet();

      expect(Array.isArray(stylesheet)).toBe(true);
      expect(stylesheet.length).toBeGreaterThan(0);
    });

    it('should include base node styles', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const nodeStyle = stylesheet.find(s => s.selector === 'node');

      expect(nodeStyle).toBeDefined();
      expect(nodeStyle?.style).toHaveProperty('background-color');
      expect(nodeStyle?.style).toHaveProperty('color');
      expect(nodeStyle?.style).toHaveProperty('text-valign');
      expect(nodeStyle?.style['text-valign']).toBe('center');
    });

    it('should include node label selectors for both label and name fields', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const labelStyle = stylesheet.find(s => s.selector === 'node[label]');
      const nameStyle = stylesheet.find(s => s.selector === 'node[name]');

      expect(labelStyle).toBeDefined();
      expect(labelStyle?.style.label).toBe('data(label)');

      expect(nameStyle).toBeDefined();
      expect(nameStyle?.style.label).toBe('data(name)');
    });

    it('should include degree-based sizing', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const degreeStyle = stylesheet.find(s => s.selector === 'node[degree]');

      expect(degreeStyle).toBeDefined();
      expect(degreeStyle?.style.width).toContain('mapData');
      expect(degreeStyle?.style.height).toContain('mapData');
      expect(degreeStyle?.style['font-size']).toContain('mapData');
    });

    it('should include hover state styles', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const hoverStyle = stylesheet.find(s => s.selector === 'node.hover');
      const unhoverStyle = stylesheet.find(s => s.selector === '.unhover');

      expect(hoverStyle).toBeDefined();
      expect(hoverStyle?.style).toHaveProperty('background-color');
      expect(hoverStyle?.style).toHaveProperty('font-weight', 'bold');

      expect(unhoverStyle).toBeDefined();
      expect(unhoverStyle?.style).toHaveProperty('opacity', 0.3);
    });

    it('should include pinned node styles', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const pinnedStyle = stylesheet.find(s => s.selector === 'node.pinned');

      expect(pinnedStyle).toBeDefined();
      expect(pinnedStyle?.style).toHaveProperty('border-style', 'solid');
      expect(pinnedStyle?.style).toHaveProperty('border-width', 2);
      expect(pinnedStyle?.style['border-color']).toContain('rgba(0, 255, 255');
    });

    it('should include edge styles', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const edgeStyle = stylesheet.find(s => s.selector === 'edge');

      expect(edgeStyle).toBeDefined();
      expect(edgeStyle?.style).toHaveProperty('line-color');
      expect(edgeStyle?.style).toHaveProperty('target-arrow-shape', 'vee');
      expect(edgeStyle?.style).toHaveProperty('curve-style', 'straight');
    });

    it('should hide self-loops', () => {
      const stylesheet = styleService.getDefaultStylesheet();
      const loopStyle = stylesheet.find(s => s.selector === ':loop');

      expect(loopStyle).toBeDefined();
      expect(loopStyle?.style).toHaveProperty('display', 'none');
    });
  });

  describe('getFrontmatterStylesheet', () => {
    it('should return frontmatter-based styles', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();

      expect(Array.isArray(stylesheet)).toBe(true);
      expect(stylesheet.length).toBeGreaterThan(0);
    });

    it('should support title override', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();
      const titleStyle = stylesheet.find(s => s.selector === 'node[title]');

      expect(titleStyle).toBeDefined();
      expect(titleStyle?.style.label).toBe('data(title)');
    });

    it('should support color override', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();
      const colorStyle = stylesheet.find(s => s.selector === 'node[color]');

      expect(colorStyle).toBeDefined();
      expect(colorStyle?.style['background-color']).toBe('data(color)');
    });

    it('should support shape override', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();
      const shapeStyle = stylesheet.find(s => s.selector === 'node[shape]');

      expect(shapeStyle).toBeDefined();
      expect(shapeStyle?.style.shape).toBe('data(shape)');
    });

    it('should support custom dimensions', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();
      const widthStyle = stylesheet.find(s => s.selector === 'node[width]');
      const heightStyle = stylesheet.find(s => s.selector === 'node[height]');

      expect(widthStyle).toBeDefined();
      expect(widthStyle?.style.width).toBe('data(width)');

      expect(heightStyle).toBeDefined();
      expect(heightStyle?.style.height).toBe('data(height)');
    });

    it('should support background images', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();
      const imageStyle = stylesheet.find(s => s.selector === 'node[image]');

      expect(imageStyle).toBeDefined();
      expect(imageStyle?.style['background-image']).toBe('data(image)');
      expect(imageStyle?.style['background-fit']).toBe('contain');
    });
  });

  describe('getCombinedStylesheet', () => {
    it('should combine default and frontmatter styles', () => {
      const combined = styleService.getCombinedStylesheet();
      const defaultStyles = styleService.getDefaultStylesheet();
      const frontmatterStyles = styleService.getFrontmatterStylesheet();

      expect(combined.length).toBe(defaultStyles.length + frontmatterStyles.length);

      // Check that both types of styles are present
      const hasNodeStyle = combined.some(s => s.selector === 'node');
      const hasFrontmatterStyle = combined.some(s => s.selector === 'node[title]');

      expect(hasNodeStyle).toBe(true);
      expect(hasFrontmatterStyle).toBe(true);
    });
  });
});