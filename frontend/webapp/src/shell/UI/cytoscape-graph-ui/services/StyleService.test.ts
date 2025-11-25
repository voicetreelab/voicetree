import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService.ts';
import type { Core } from 'cytoscape';

describe('StyleService', () => {
  let styleService: StyleService;
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    // Save original matchMedia
    originalMatchMedia = window.matchMedia;
    styleService = new StyleService();
  });

  afterEach(() => {
    // Restore original matchMedia after each test
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    }
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  });

  describe('Dark/Light Mode Detection', () => {

    it('should use dark text color (#2a2a2a) in light mode', () => {
      // Mock light mode: no dark class and prefers-color-scheme: light
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('dark') ? false : true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;

      // Ensure no dark class on elements
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');

      const lightModeService = new StyleService();
      const stylesheet = lightModeService.getDefaultStylesheet();

      const nodeStyle = stylesheet.find(s => s.selector === 'node');
      const edgeStyle = stylesheet.find(s => s.selector === 'edge');

      // In light mode, text should be dark (#2a2a2a)
      expect(nodeStyle?.style.color).toBe('#2a2a2a');
      expect(edgeStyle?.style.color).toBe('#2a2a2a');
    });

    it('should use light text color (#dcddde) in dark mode', () => {
      // Mock matchMedia (though it's now ignored by StyleService)
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('dark') ? true : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;

      // Add dark class to set app to dark mode (the only thing StyleService checks now)
      document.documentElement.classList.add('dark');

      const darkModeService = new StyleService();
      const stylesheet = darkModeService.getDefaultStylesheet();

      const nodeStyle = stylesheet.find(s => s.selector === 'node');
      const edgeStyle = stylesheet.find(s => s.selector === 'edge');

      // In dark mode, text should be light (#dcddde)
      expect(nodeStyle?.style.color).toBe('#dcddde');
      expect(edgeStyle?.style.color).toBe('#dcddde');

      // Cleanup
      document.documentElement.classList.remove('dark');
    });

    it('should detect dark mode from dark class on document element', () => {
      // Mock matchMedia to return light mode
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;

      // Add dark class to html element
      document.documentElement.classList.add('dark');

      const darkClassService = new StyleService();
      const stylesheet = darkClassService.getDefaultStylesheet();

      const nodeStyle = stylesheet.find(s => s.selector === 'node');

      // Should still use light text color because dark class is present
      expect(nodeStyle?.style.color).toBe('#dcddde');

      // Cleanup
      document.documentElement.classList.remove('dark');
    });

    it('should use dark text when app is in light mode even if OS prefers dark', () => {
      // CRITICAL TEST: OS prefers dark, but app explicitly set to light mode
      // This is the bug fix - app's explicit theme (DOM class) should override OS preference

      // Mock matchMedia to simulate OS preferring dark mode
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('dark') ? true : false, // OS prefers dark
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;

      // Ensure NO dark class on elements (app is in light mode)
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');

      const lightModeService = new StyleService();
      const stylesheet = lightModeService.getDefaultStylesheet();

      const nodeStyle = stylesheet.find(s => s.selector === 'node');
      const edgeStyle = stylesheet.find(s => s.selector === 'edge');

      // Even though OS prefers dark, app is in light mode, so text must be DARK
      expect(nodeStyle?.style.color).toBe('#2a2a2a');
      expect(edgeStyle?.style.color).toBe('#2a2a2a');
    });
  });

  describe('getDefaultStylesheet', () => {
    it('should return an array of stylesheet rules', () => {
      const stylesheet = styleService.getDefaultStylesheet();

      expect(Array.isArray(stylesheet)).toBe(true);
      expect(stylesheet.length).toBeGreaterThan(0);
    });

    it('should include all essential stylesheet selectors and properties', () => {
      const stylesheet = styleService.getDefaultStylesheet();

      // Base node styles
      const nodeStyle = stylesheet.find(s => s.selector === 'node');
      expect(nodeStyle).toBeDefined();
      expect(nodeStyle?.style).toHaveProperty('background-color');
      expect(nodeStyle?.style).toHaveProperty('color');
      expect(nodeStyle?.style).toHaveProperty('text-valign', 'bottom');
      expect(nodeStyle?.style).toHaveProperty('text-margin-y', 3);
      expect(nodeStyle?.style).toHaveProperty('border-width', 1);
      expect(nodeStyle?.style).toHaveProperty('border-color', '#666');

      // Node label selectors
      const labelStyle = stylesheet.find(s => s.selector === 'node[label]');
      const nameStyle = stylesheet.find(s => s.selector === 'node[name]');
      expect(labelStyle).toBeDefined();
      expect(labelStyle?.style.label).toBe('data(label)');
      expect(nameStyle).toBeDefined();
      expect(nameStyle?.style.label).toBe('data(name)');

      // Hover state styles
      const hoverStyle = stylesheet.find(s => s.selector === 'node.hover');
      const unhoverStyle = stylesheet.find(s => s.selector === '.unhover');
      expect(hoverStyle).toBeDefined();
      expect(hoverStyle?.style).toHaveProperty('background-color');
      expect(hoverStyle?.style).toHaveProperty('font-weight', 'bold');
      expect(unhoverStyle).toBeDefined();
      expect(unhoverStyle?.style).toHaveProperty('opacity', 0.3);

      // Pinned node styles
      const pinnedStyle = stylesheet.find(s => s.selector === 'node.pinned');
      expect(pinnedStyle).toBeDefined();
      expect(pinnedStyle?.style).toHaveProperty('border-style', 'solid');
      expect(pinnedStyle?.style).toHaveProperty('border-width', 2);
      expect(pinnedStyle?.style['border-color']).toContain('rgba(0, 255, 255');

      // Edge styles
      const edgeStyle = stylesheet.find(s => s.selector === 'edge');
      expect(edgeStyle).toBeDefined();
      expect(edgeStyle?.style).toHaveProperty('line-color');
      expect(edgeStyle?.style).toHaveProperty('target-arrow-shape', 'triangle');
      expect(edgeStyle?.style).toHaveProperty('target-arrow-fill', 'hollow');
      expect(edgeStyle?.style).toHaveProperty('line-opacity', 0.3);
      expect(edgeStyle?.style).toHaveProperty('curve-style', 'straight');

      // Self-loop hiding
      const loopStyle = stylesheet.find(s => s.selector === ':loop');
      expect(loopStyle).toBeDefined();
      expect(loopStyle?.style).toHaveProperty('display', 'none');
    });

    it('should update node sizes based on degree programmatically', () => {
      // Create a mock Cytoscape instance with nodes
      const mockNodes = [
        {
          data: () => undefined,
          degree: () => 0,
          style: vi.fn()
        },
        {
          data: () => undefined,
          degree: () => 30,
          style: vi.fn()
        },
        {
          data: () => undefined,
          degree: () => 60,
          style: vi.fn()
        }
      ];

      const mockCy = {
        nodes: () => mockNodes
      } as unknown as Core;

      styleService.updateNodeSizes(mockCy);

      // Verify style was applied to each node
      expect(mockNodes[0].style).toHaveBeenCalled();
      expect(mockNodes[1].style).toHaveBeenCalled();
      expect(mockNodes[2].style).toHaveBeenCalled();

      // Extract the applied sizes
      const size0 = mockNodes[0].style.mock.calls[0][0].width;
      const size1 = mockNodes[1].style.mock.calls[0][0].width;
      const size2 = mockNodes[2].style.mock.calls[0][0].width;

      // Verify sizes increase with degree: degree 0 < degree 30 < degree 60
      expect(size0).toBeLessThan(size1);
      expect(size1).toBeLessThan(size2);
    });
  });

  describe('getFrontmatterStylesheet', () => {
    it('should support all frontmatter property overrides', () => {
      const stylesheet = styleService.getFrontmatterStylesheet();

      expect(Array.isArray(stylesheet)).toBe(true);
      expect(stylesheet.length).toBeGreaterThan(0);

      // Title override
      const titleStyle = stylesheet.find(s => s.selector === 'node[title]');
      expect(titleStyle).toBeDefined();
      expect(titleStyle?.style.label).toBe('data(title)');

      // Color override
      const colorStyle = stylesheet.find(s => s.selector === 'node[color]');
      expect(colorStyle).toBeDefined();
      expect(colorStyle?.style['background-color']).toBe('data(color)');

      // Shape override
      const shapeStyle = stylesheet.find(s => s.selector === 'node[shape]');
      expect(shapeStyle).toBeDefined();
      expect(shapeStyle?.style.shape).toBe('data(shape)');

      // Custom dimensions
      const widthStyle = stylesheet.find(s => s.selector === 'node[width]');
      const heightStyle = stylesheet.find(s => s.selector === 'node[height]');
      expect(widthStyle).toBeDefined();
      expect(widthStyle?.style.width).toBe('data(width)');
      expect(heightStyle).toBeDefined();
      expect(heightStyle?.style.height).toBe('data(height)');

      // Background images
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