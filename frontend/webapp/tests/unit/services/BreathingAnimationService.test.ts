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
        { data: { id: 'test-node', label: 'Test Node' } }
      ]
    });

    node = cy.getElementById('test-node') as NodeSingular;
    service = new BreathingAnimationService();
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
        call => call[1] === 10000
      );
      expect(newNodeTimeoutCalls.length).toBe(0);

      vi.clearAllMocks();

      // APPENDED_CONTENT has a 10s timeout
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      const appendedTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 10000
      );
      expect(appendedTimeoutCalls.length).toBe(1);

      vi.clearAllMocks();

      // PINNED has no timeout (0 means no timeout)
      service.addBreathingAnimation(node, AnimationType.PINNED);
      const pinnedTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] === 10000
      );
      expect(pinnedTimeoutCalls.length).toBe(0);

      vi.useRealTimers();
    });

    it('should stop existing animation before adding new one', () => {
      const stopAnimationSpy = vi.spyOn(service, 'stopAnimation');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.addBreathingAnimation(node, AnimationType.PINNED);

      expect(stopAnimationSpy).toHaveBeenCalledWith('test-node');
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

    it('should not force inline styles - let stylesheet cascade', () => {
      vi.useFakeTimers();

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Clear previous mock calls
      const styleSpy = vi.spyOn(node, 'style');

      service.stopAnimationForNode(node);

      // Should NOT call style() - we let the stylesheet cascade handle it
      // This preserves other class-based styles (pinned, frontmatter, etc.)
      expect(styleSpy).not.toHaveBeenCalled();

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
});
