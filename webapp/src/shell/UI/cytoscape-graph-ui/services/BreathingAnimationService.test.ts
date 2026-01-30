import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { BreathingAnimationService, AnimationType } from '@/shell/UI/cytoscape-graph-ui/services/BreathingAnimationService';
import cytoscape, { type NodeSingular } from 'cytoscape';

describe('BreathingAnimationService', () => {
  let service: BreathingAnimationService;
  let cy: cytoscape.Core;
  let node: NodeSingular;

  beforeEach(() => {
    // Create a cytoscape instance with a test node
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'test-node', label: 'Test GraphNode' } }
      ]
    });

    node = cy.getElementById('test-node') as NodeSingular;
    service = new BreathingAnimationService(cy);
  });

  afterEach(() => {
    service.destroy();
    cy.destroy();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('addBreathingAnimation', () => {
    it('should add breathing animation to a node', () => {
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      expect(node.data('breathingActive')).toBe(true);
      expect(node.data('animationType')).toBe(AnimationType.NEW_NODE);
    });

    it('should apply correct animation classes and toggle between expand/contract', () => {
      vi.useFakeTimers();

      // Test NEW_NODE animation starts with expand class and toggles correctly
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      expect(node.hasClass('breathing-new-expand')).toBe(true);
      expect(node.hasClass('breathing-new-contract')).toBe(false);

      // After duration, should switch to contract class
      vi.advanceTimersByTime(1000);
      expect(node.hasClass('breathing-new-expand')).toBe(false);
      expect(node.hasClass('breathing-new-contract')).toBe(true);

      // After another duration, should switch back to expand
      vi.advanceTimersByTime(1000);
      expect(node.hasClass('breathing-new-expand')).toBe(true);
      expect(node.hasClass('breathing-new-contract')).toBe(false);

      service.stopAnimationForNode(node);

      // Test PINNED animation (orange) - starts with expand class
      service.addBreathingAnimation(node, AnimationType.PINNED);
      expect(node.hasClass('breathing-pinned-expand')).toBe(true);

      service.stopAnimationForNode(node);

      // Test APPENDED_CONTENT animation (cyan) - starts with expand class
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      expect(node.hasClass('breathing-appended-expand')).toBe(true);

      vi.useRealTimers();
    });

    it('should set timeout for animations with timeout config', () => {
      vi.useFakeTimers();
      const setTimeoutSpy: MockInstance<typeof setTimeout> = vi.spyOn(global, 'setTimeout');

      // NEW_NODE has no timeout (0 = no timeout, persists until next node)
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      const newNodeTimeoutCalls: [callback: (_: void) => void, delay?: number | undefined][] = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(newNodeTimeoutCalls.length).toBe(0);

      vi.clearAllMocks();

      // APPENDED_CONTENT has a 15s timeout
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      const appendedTimeoutCalls: [callback: (_: void) => void, delay?: number | undefined][] = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(appendedTimeoutCalls.length).toBe(1);

      vi.clearAllMocks();

      // PINNED has no timeout (0 means no timeout)
      service.addBreathingAnimation(node, AnimationType.PINNED);
      const pinnedTimeoutCalls: [callback: (_: void) => void, delay?: number | undefined][] = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(pinnedTimeoutCalls.length).toBe(0);

      vi.useRealTimers();
    });

    it('should stop existing animation before adding new one', () => {
      const stopAnimationSpy: MockInstance<(node: NodeSingular) => void> = vi.spyOn(service, 'stopAnimationForNode');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.addBreathingAnimation(node, AnimationType.PINNED);

      expect(stopAnimationSpy).toHaveBeenCalled();
    });
  });

  describe('stopAnimationForNode', () => {
    it('should mark node as inactive', () => {
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Verify it's active initially
      expect(node.data('breathingActive')).toBe(true);

      service.stopAnimationForNode(node);

      // After stopping, the data is set to false
      expect(node.data('breathingActive')).toBe(false);
    });

    it('should reset border styles to allow stylesheet cascade', () => {
      vi.useFakeTimers();

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Spy on removeStyle to verify border properties are reset
      const removeStyleSpy: MockInstance<(names?: string) => cytoscape.NodeSingular> = vi.spyOn(node, 'removeStyle');

      service.stopAnimationForNode(node);

      // Should call removeStyle to clear animation-applied inline border styles
      // This allows the stylesheet cascade to take over (degree-based border, pinned class, etc.)
      expect(removeStyleSpy).toHaveBeenCalledWith('border-width');
      expect(removeStyleSpy).toHaveBeenCalledWith('border-color');
      expect(removeStyleSpy).toHaveBeenCalledWith('border-opacity');
      expect(removeStyleSpy).toHaveBeenCalledWith('border-style');
      expect(removeStyleSpy).toHaveBeenCalledTimes(4);

      vi.useRealTimers();
    });

    it('should remove animation classes and data from node', () => {
      vi.useFakeTimers();
      const removeDataSpy: MockInstance<(...names: string[]) => cytoscape.CollectionReturnValue> = vi.spyOn(node, 'removeData');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Animation classes should be present
      expect(
        node.hasClass('breathing-new-expand') || node.hasClass('breathing-new-contract')
      ).toBe(true);

      service.stopAnimationForNode(node);

      // Animation classes should be removed
      expect(node.hasClass('breathing-new-expand')).toBe(false);
      expect(node.hasClass('breathing-new-contract')).toBe(false);

      // Animation data should be removed
      expect(removeDataSpy).toHaveBeenCalledWith('animationType');

      vi.useRealTimers();
    });

    it('should clear the animation interval', () => {
      vi.useFakeTimers();
      const clearIntervalSpy: MockInstance<{ (id: number | undefined): void; (timeout: NodeJS.Timeout | string | number | undefined): void; }> = vi.spyOn(global, 'clearInterval');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);

      expect(clearIntervalSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('stopAllAnimations', () => {
    it('should stop animations for all nodes', () => {
      const node2: cytoscape.NodeSingular = cy.add({ data: { id: 'test-node-2' } })[0] as NodeSingular;

      const nodes: cytoscape.NodeCollection = cy.nodes();
      service.addBreathingAnimation(nodes, AnimationType.NEW_NODE);

      const stopSpy: MockInstance<(node: NodeSingular) => void> = vi.spyOn(service, 'stopAnimationForNode');
      service.stopAllAnimations(nodes);

      expect(stopSpy).toHaveBeenCalledTimes(2);
      expect(stopSpy).toHaveBeenCalledWith(node);
      expect(stopSpy).toHaveBeenCalledWith(node2);
    });
  });

  describe('isAnimationActive', () => {
    it('should correctly report animation state', () => {
      // Initially false
      expect(service.isAnimationActive(node)).toBe(false);

      // True when animation is active
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      expect(service.isAnimationActive(node)).toBe(true);

      // False after stopping animation
      service.stopAnimationForNode(node);
      expect(service.isAnimationActive(node)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clear all timeouts and intervals', () => {
      vi.useFakeTimers();
      const clearTimeoutSpy: MockInstance<{ (id: number | undefined): void; (timeout: NodeJS.Timeout | string | number | undefined): void; }> = vi.spyOn(global, 'clearTimeout');
      const clearIntervalSpy: MockInstance<{ (id: number | undefined): void; (timeout: NodeJS.Timeout | string | number | undefined): void; }> = vi.spyOn(global, 'clearInterval');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);

      service.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('Animation persistence and select-to-clear behavior', () => {
    it('should persist NEW_NODE animations until node is selected', () => {
      vi.useFakeTimers();

      // Destroy existing service and create a fresh cy instance for this test
      service.destroy();
      cy.destroy();

      cy = cytoscape({ headless: true });
      service = new BreathingAnimationService(cy);

      // Add multiple nodes - all should persist their animations
      const node1: cytoscape.NodeSingular = cy.add({ data: { id: 'node-1', label: 'GraphNode 1' } })[0] as NodeSingular;
      const node2: cytoscape.NodeSingular = cy.add({ data: { id: 'node-2', label: 'GraphNode 2' } })[0] as NodeSingular;
      const node3: cytoscape.NodeSingular = cy.add({ data: { id: 'node-3', label: 'GraphNode 3' } })[0] as NodeSingular;

      // All nodes should be breathing
      expect(node1.data('breathingActive')).toBe(true);
      expect(node2.data('breathingActive')).toBe(true);
      expect(node3.data('breathingActive')).toBe(true);

      // Advance time significantly - NEW_NODE animations should NOT timeout
      vi.advanceTimersByTime(60000);

      // All nodes should STILL be breathing (no timeout for NEW_NODE)
      expect(node1.data('breathingActive')).toBe(true);
      expect(node2.data('breathingActive')).toBe(true);
      expect(node3.data('breathingActive')).toBe(true);

      // Select node2 - should stop its animation
      node2.select();

      expect(node1.data('breathingActive')).toBe(true);
      expect(node2.data('breathingActive')).toBeFalsy(); // Stopped by select
      expect(node3.data('breathingActive')).toBe(true);

      vi.useRealTimers();
    });

    it('should stop APPENDED_CONTENT animation on select', () => {
      vi.useFakeTimers();

      service.destroy();
      cy.destroy();

      cy = cytoscape({ headless: true });
      service = new BreathingAnimationService(cy);

      const node1: cytoscape.NodeSingular = cy.add({ data: { id: 'node-1', label: 'GraphNode 1' } })[0] as NodeSingular;

      // Switch to APPENDED_CONTENT animation
      service.startBreathingAnimation(node1, AnimationType.APPENDED_CONTENT);
      expect(node1.data('breathingActive')).toBe(true);
      expect(node1.data('animationType')).toBe(AnimationType.APPENDED_CONTENT);

      // Select should stop it
      node1.select();
      expect(node1.data('breathingActive')).toBeFalsy();

      vi.useRealTimers();
    });

    it('should NOT stop PINNED animation on select', () => {
      vi.useFakeTimers();

      service.destroy();
      cy.destroy();

      cy = cytoscape({ headless: true });
      service = new BreathingAnimationService(cy);

      const node1: cytoscape.NodeSingular = cy.add({ data: { id: 'node-1', label: 'GraphNode 1' } })[0] as NodeSingular;

      // Start PINNED animation
      service.startBreathingAnimation(node1, AnimationType.PINNED);
      expect(node1.data('breathingActive')).toBe(true);
      expect(node1.data('animationType')).toBe(AnimationType.PINNED);

      // Select should NOT stop PINNED animation
      node1.select();
      expect(node1.data('breathingActive')).toBe(true);

      vi.useRealTimers();
    });

    it('should still timeout APPENDED_CONTENT after 15s if not selected', () => {
      vi.useFakeTimers();

      service.destroy();
      cy.destroy();

      cy = cytoscape({ headless: true });
      service = new BreathingAnimationService(cy);

      const node1: cytoscape.NodeSingular = cy.add({ data: { id: 'node-1', label: 'GraphNode 1' } })[0] as NodeSingular;

      // Switch to APPENDED_CONTENT animation (has 15s timeout)
      service.startBreathingAnimation(node1, AnimationType.APPENDED_CONTENT);
      expect(node1.data('breathingActive')).toBe(true);

      // Advance past timeout
      vi.advanceTimersByTime(15500);

      expect(node1.data('breathingActive')).toBeFalsy();

      vi.useRealTimers();
    });
  });
});
