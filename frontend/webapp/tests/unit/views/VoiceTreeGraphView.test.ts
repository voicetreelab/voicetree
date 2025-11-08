/**
 * VoiceTreeGraphView Unit Tests with Functional Graph
 *
 * Tests VoiceTreeGraphView's integration with the functional graph state from main process.
 * VoiceTreeGraphView now receives graph state via electronAPI.graph.onStateChanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoiceTreeGraphView } from '@/views/VoiceTreeGraphView';


describe('VoiceTreeGraphView with Functional Graph', () => {
  let container: HTMLElement;
  let graph: VoiceTreeGraphView;

  beforeEach(() => {
    // Create container for graph
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';

    // JSDOM doesn't calculate dimensions from styles, so we need to stub them BEFORE appending
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true });
    container.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 800, width: 800, height: 600,
      toJSON: () => ({})
    });

    document.body.appendChild(container);

    // Create graph instance for unit tests
    graph = new VoiceTreeGraphView(container);
  });

  afterEach(() => {
    // Cleanup
    graph.dispose();
    document.body.removeChild(container);
  });

  // ==========================================================================
  // BASIC TESTS
  // ==========================================================================

  it('should create graph instance without errors', () => {
    expect(graph).toBeDefined();
  });

  it('should render cytoscape container', () => {
    const cyContainer = container.querySelector('[data-id="cy"]');
    expect(cyContainer).toBeTruthy();
  });

  it('should return empty selected nodes initially', () => {
    const selected = graph.getSelectedNodes();
    expect(selected).toEqual([]);
  });

  it('should return stats with zero nodes and edges initially', () => {
    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
  });

  it('should support dark mode toggle', () => {
    const initialMode = graph.isDarkMode();
    graph.toggleDarkMode();
    expect(graph.isDarkMode()).toBe(!initialMode);
  });
});
