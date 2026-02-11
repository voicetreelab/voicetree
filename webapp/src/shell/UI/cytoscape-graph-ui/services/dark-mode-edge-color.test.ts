/**
 * Test to verify edge colors actually change when toggling dark mode
 * This test verifies the exact issue: edge colors not updating on dark mode toggle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService';

describe('Dark Mode Edge Color Toggle', () => {
  beforeEach(() => {
    // Ensure clean state - light mode (no dark class)
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  });

  afterEach(() => {
    // Cleanup
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  });

  it('should return DIFFERENT edge colors for light vs dark mode', () => {
    // Get light mode edge color
    const lightModeService: StyleService = new StyleService();
    const lightStylesheet: { selector: string; style: Record<string, unknown> }[] = lightModeService.getDefaultStylesheet();
    const lightEdgeStyle: { selector: string; style: Record<string, unknown> } | undefined = lightStylesheet.find(s => s.selector === 'edge');
    const lightEdgeColor: unknown = lightEdgeStyle?.style['line-color'];

    // Switch to dark mode
    document.documentElement.classList.add('dark');

    // Get dark mode edge color (new instance to pick up the change)
    const darkModeService: StyleService = new StyleService();
    const darkStylesheet: { selector: string; style: Record<string, unknown> }[] = darkModeService.getDefaultStylesheet();
    const darkEdgeStyle: { selector: string; style: Record<string, unknown> } | undefined = darkStylesheet.find(s => s.selector === 'edge');
    const darkEdgeColor: unknown = darkEdgeStyle?.style['line-color'];

    console.log('[Test] Light mode edge color:', lightEdgeColor);
    console.log('[Test] Dark mode edge color:', darkEdgeColor);

    // The colors MUST be different
    expect(lightEdgeColor).toBeDefined();
    expect(darkEdgeColor).toBeDefined();
    expect(lightEdgeColor).not.toBe(darkEdgeColor);

    // Verify the specific expected colors
    expect(lightEdgeColor).toBe('#5e5e5e'); // Light mode edge color
    expect(darkEdgeColor).toBe('#c0c5cc');  // Dark mode edge color - lighter for better visibility
  });

  it('should return DIFFERENT arrow colors for light vs dark mode', () => {
    // Get light mode arrow color
    const lightModeService: StyleService = new StyleService();
    const lightStylesheet: { selector: string; style: Record<string, unknown> }[] = lightModeService.getDefaultStylesheet();
    const lightEdgeStyle: { selector: string; style: Record<string, unknown> } | undefined = lightStylesheet.find(s => s.selector === 'edge');
    const lightArrowColor: unknown = lightEdgeStyle?.style['target-arrow-color'];

    // Switch to dark mode
    document.documentElement.classList.add('dark');

    // Get dark mode arrow color
    const darkModeService: StyleService = new StyleService();
    const darkStylesheet: { selector: string; style: Record<string, unknown> }[] = darkModeService.getDefaultStylesheet();
    const darkEdgeStyle: { selector: string; style: Record<string, unknown> } | undefined = darkStylesheet.find(s => s.selector === 'edge');
    const darkArrowColor: unknown = darkEdgeStyle?.style['target-arrow-color'];

    console.log('[Test] Light mode arrow color:', lightArrowColor);
    console.log('[Test] Dark mode arrow color:', darkArrowColor);

    // Arrow colors must also be different
    expect(lightArrowColor).toBe('#5e5e5e');
    expect(darkArrowColor).toBe('#c0c5cc'); // Lighter for better visibility
  });

  it('should pick up dark class change immediately when creating new StyleService', () => {
    // Start in light mode
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Create initial service - should be light mode
    const service1: StyleService = new StyleService();
    const sheet1: { selector: string; style: Record<string, unknown> }[] = service1.getDefaultStylesheet();
    const edgeColor1: unknown = sheet1.find(s => s.selector === 'edge')?.style['line-color'];
    expect(edgeColor1).toBe('#5e5e5e'); // Light mode

    // Toggle to dark mode (exactly as VoiceTreeGraphView.toggleDarkMode does)
    document.documentElement.classList.add('dark');

    // Create new service - should IMMEDIATELY see dark mode
    const service2: StyleService = new StyleService();
    const sheet2: { selector: string; style: Record<string, unknown> }[] = service2.getDefaultStylesheet();
    const edgeColor2: unknown = sheet2.find(s => s.selector === 'edge')?.style['line-color'];
    expect(edgeColor2).toBe('#c0c5cc'); // Dark mode - lighter for better visibility

    // Toggle back to light mode
    document.documentElement.classList.remove('dark');

    // Create new service - should see light mode again
    const service3: StyleService = new StyleService();
    const sheet3: { selector: string; style: Record<string, unknown> }[] = service3.getDefaultStylesheet();
    const edgeColor3: unknown = sheet3.find(s => s.selector === 'edge')?.style['line-color'];
    expect(edgeColor3).toBe('#5e5e5e'); // Light mode again
  });

  it('should verify text color also changes (as reference)', () => {
    // Get light mode text color
    const lightModeService: StyleService = new StyleService();
    const lightStylesheet: { selector: string; style: Record<string, unknown> }[] = lightModeService.getDefaultStylesheet();
    const lightNodeStyle: { selector: string; style: Record<string, unknown> } | undefined = lightStylesheet.find(s => s.selector === 'node');
    const lightTextColor: unknown = lightNodeStyle?.style.color;

    // Switch to dark mode
    document.documentElement.classList.add('dark');

    // Get dark mode text color
    const darkModeService: StyleService = new StyleService();
    const darkStylesheet: { selector: string; style: Record<string, unknown> }[] = darkModeService.getDefaultStylesheet();
    const darkNodeStyle: { selector: string; style: Record<string, unknown> } | undefined = darkStylesheet.find(s => s.selector === 'node');
    const darkTextColor: unknown = darkNodeStyle?.style.color;

    console.log('[Test] Light mode text color:', lightTextColor);
    console.log('[Test] Dark mode text color:', darkTextColor);

    // Text colors must be different
    expect(lightTextColor).toBe('#2a2a2a'); // Dark text on light background
    expect(darkTextColor).toBe('#c5c8cc');  // Light text on dark background
  });
});
