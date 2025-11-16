import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BreathingAnimationService, AnimationType } from '@/graph-core/services/BreathingAnimationService';
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

    it('should apply correct classes for different animation types', () => {
      vi.useFakeTimers();

      // Test NEW_NODE animation (green) - starts with expand class
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      expect(node.hasClass('breathing-new-expand')).toBe(true);

      service.stopAnimationForNode(node);
      vi.clearAllMocks();

      // Test PINNED animation (orange) - starts with expand class
      service.addBreathingAnimation(node, AnimationType.PINNED);
      expect(node.hasClass('breathing-pinned-expand')).toBe(true);

      service.stopAnimationForNode(node);
      vi.clearAllMocks();

      // Test APPENDED_CONTENT animation (cyan) - starts with expand class
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      expect(node.hasClass('breathing-appended-expand')).toBe(true);

      vi.useRealTimers();
    });

    it('should toggle between expand and contract classes', () => {
      vi.useFakeTimers();

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Should start with expand class
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

      vi.useRealTimers();
    });

    it('should set timeout for animations with timeout config', () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // NEW_NODE has no timeout (0 = no timeout, persists until next node)
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      const newNodeTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(newNodeTimeoutCalls.length).toBe(0);

      vi.clearAllMocks();

      // APPENDED_CONTENT has a 15s timeout
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      const appendedTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(appendedTimeoutCalls.length).toBe(1);

      vi.clearAllMocks();

      // PINNED has no timeout (0 means no timeout)
      service.addBreathingAnimation(node, AnimationType.PINNED);
      const pinnedTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 15000
      );
      expect(pinnedTimeoutCalls.length).toBe(0);

      vi.useRealTimers();
    });

    it('should stop existing animation before adding new one', () => {
      const stopAnimationSpy = vi.spyOn(service, 'stopAnimationForNode');

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
      const removeStyleSpy = vi.spyOn(node, 'removeStyle');

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

    it('should remove animation classes', () => {
      vi.useFakeTimers();

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Animation classes should be present
      expect(
        node.hasClass('breathing-new-expand') || node.hasClass('breathing-new-contract')
      ).toBe(true);

      service.stopAnimationForNode(node);

      // Animation classes should be removed
      expect(node.hasClass('breathing-new-expand')).toBe(false);
      expect(node.hasClass('breathing-new-contract')).toBe(false);

      vi.useRealTimers();
    });

    it('should remove animation data from node', () => {
      // Spy on the removeData method
      const removeDataSpy = vi.spyOn(node, 'removeData');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);

      expect(removeDataSpy).toHaveBeenCalledWith('animationType');
    });

    it('should clear the animation interval', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);

      expect(clearIntervalSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('stopAllAnimations', () => {
    it('should stop animations for all nodes', () => {
      const node2 = cy.add({ data: { id: 'test-node-2' } })[0] as NodeSingular;

      const nodes = cy.nodes();
      service.addBreathingAnimation(nodes, AnimationType.NEW_NODE);

      const stopSpy = vi.spyOn(service, 'stopAnimationForNode');
      service.stopAllAnimations(nodes);

      expect(stopSpy).toHaveBeenCalledTimes(2);
      expect(stopSpy).toHaveBeenCalledWith(node);
      expect(stopSpy).toHaveBeenCalledWith(node2);
    });
  });

  describe('isAnimationActive', () => {
    it('should return true when animation is active', () => {
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      expect(service.isAnimationActive(node)).toBe(true);
    });

    it('should return false when animation is not active', () => {
      expect(service.isAnimationActive(node)).toBe(false);
    });

    it('should return false after stopping animation', () => {
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);
      expect(service.isAnimationActive(node)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clear all timeouts and intervals', () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);

      service.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('Bug reproduction: new node -> update -> multiple new nodes', () => {
    it('should handle sequence: node1 new -> node1 update -> node2 new -> node3 new correctly', () => {
      vi.useFakeTimers();

      // Destroy existing service and create a fresh cy instance for this test
      // This ensures we have full control over when animations start
      service.destroy();
      cy.destroy();

      // Create fresh cy instance without any nodes
      cy = cytoscape({ headless: true });
      service = new BreathingAnimationService(cy);

      // Step 1: Add node 1 (green breathing, no timeout) - event listener handles this
      const node1 = cy.add({ data: { id: 'node-1', label: 'GraphNode 1' } })[0] as NodeSingular;
      expect(node1.data('breathingActive')).toBe(true);
      expect(node1.data('animationType')).toBe(AnimationType.NEW_NODE);
      expect(node1.hasClass('breathing-new-expand')).toBe(true);

      // Step 2: Update node 1 (blue breathing, 15s timeout)
      // Simulate content change by manually calling (since we don't have file watcher)
      service.startBreathingAnimation(node1, AnimationType.APPENDED_CONTENT);
      expect(node1.data('breathingActive')).toBe(true);
      expect(node1.data('animationType')).toBe(AnimationType.APPENDED_CONTENT);
      expect(node1.hasClass('breathing-appended-expand')).toBe(true);
      // GraphNode 1 should NOT have green classes anymore
      expect(node1.hasClass('breathing-new-expand')).toBe(false);
      expect(node1.hasClass('breathing-new-contract')).toBe(false);

      // Step 3: Add node 2 (green breathing, no timeout)
      // Event listener will handle animation AND give node1 a 15s timeout
      const node2 = cy.add({ data: { id: 'node-2', label: 'GraphNode 2' } })[0] as NodeSingular;
      expect(node2.data('breathingActive')).toBe(true);
      expect(node2.data('animationType')).toBe(AnimationType.NEW_NODE);

      // Advance time by 15.5s - node1 should stop (15s timeout)
      vi.advanceTimersByTime(15500);

      // GraphNode 1 should be completely stopped (no breathing, no border, no classes)
      expect(node1.data('breathingActive')).toBeFalsy();
      expect(node1.hasClass('breathing-appended-expand')).toBe(false);
      expect(node1.hasClass('breathing-appended-contract')).toBe(false);
      expect(node1.hasClass('breathing-new-expand')).toBe(false);
      expect(node1.hasClass('breathing-new-contract')).toBe(false);

      // GraphNode 2 should still be breathing (no timeout yet)
      expect(node2.data('breathingActive')).toBe(true);

      // Step 4: Add node 3 (green breathing, no timeout)
      // Event listener will give node2 a 15s timeout
      const node3 = cy.add({ data: { id: 'node-3', label: 'GraphNode 3' } })[0] as NodeSingular;
      expect(node3.data('breathingActive')).toBe(true);
      expect(node3.data('animationType')).toBe(AnimationType.NEW_NODE);

      // Advance time by 15.5s - node2 should stop, node3 should continue
      vi.advanceTimersByTime(15500);

      // GraphNode 1 should still be stopped
      expect(node1.data('breathingActive')).toBeFalsy();

      // GraphNode 2 should be stopped
      expect(node2.data('breathingActive')).toBeFalsy();
      expect(node2.hasClass('breathing-new-expand')).toBe(false);
      expect(node2.hasClass('breathing-new-contract')).toBe(false);

      // GraphNode 3 should STILL be breathing indefinitely (this is the key behavior)
      expect(node3.data('breathingActive')).toBe(true);
      expect(node3.data('animationType')).toBe(AnimationType.NEW_NODE);

      vi.useRealTimers();
    });
  });
});
