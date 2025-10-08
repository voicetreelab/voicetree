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

    // Mock the animate function since it won't work in headless mode
    vi.spyOn(node, 'animate').mockImplementation((options: cytoscape.AnimateOptions) => {
      // Simulate immediate completion for testing
      if (options.complete) {
        setTimeout(() => options.complete(), 0);
      }
      return {
        play: vi.fn().mockReturnThis(),
        promise: vi.fn().mockResolvedValue(undefined)
      } as ReturnType<NodeSingular['animate']>;
    });

    vi.spyOn(node, 'stop').mockImplementation(() => node);

    // Store style values for mocking
    const styleValues: Record<string, string> = {};

    // Mock style() method to handle both setting and getting
    const originalStyle = node.style.bind(node);
    vi.spyOn(node, 'style').mockImplementation((name: string, value?: string) => {
      if (value !== undefined) {
        // Setting a style
        styleValues[name] = value;
        return originalStyle(name, value);
      } else {
        // Getting a style
        return styleValues[name] || originalStyle(name);
      }
    });
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

    it('should store original border values', () => {
      // Set initial border style
      node.style('border-width', '3px');
      node.style('border-color', '#ff0000');

      service.addBreathingAnimation(node, AnimationType.PINNED);

      expect(node.data('originalBorderWidth')).toBe('3px');
      expect(node.data('originalBorderColor')).toBe('#ff0000');
    });

    it('should apply different colors for different animation types', () => {
      // Test NEW_NODE animation (green)
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      expect(node.animate).toHaveBeenCalledWith(
        expect.objectContaining({
          style: expect.objectContaining({
            'border-color': 'rgba(0, 255, 0, 0.9)'
          })
        })
      );

      vi.clearAllMocks();

      // Test PINNED animation (orange)
      service.addBreathingAnimation(node, AnimationType.PINNED);
      expect(node.animate).toHaveBeenCalledWith(
        expect.objectContaining({
          style: expect.objectContaining({
            'border-color': 'rgba(255, 165, 0, 0.9)'
          })
        })
      );

      vi.clearAllMocks();

      // Test APPENDED_CONTENT animation (cyan)
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
      expect(node.animate).toHaveBeenCalledWith(
        expect.objectContaining({
          style: expect.objectContaining({
            'border-color': 'rgba(0, 255, 255, 0.9)'
          })
        })
      );
    });

    it('should set timeout for animations with timeout config', () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // NEW_NODE has no timeout (0 = no timeout, persists until next node)
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      const newNodeTimeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => call[1] > 0
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
        call => call[1] > 0
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

    it('should clear border styles completely', () => {
      // Set initial styles
      node.style('border-width', '5px');
      node.style('border-color', '#00ff00');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);

      // Clear previous mock calls
      vi.clearAllMocks();

      service.stopAnimationForNode(node);

      // Check that style was called to clear the border completely
      expect(node.style).toHaveBeenCalledWith({
        'border-width': '0',
        'border-color': 'rgba(0, 0, 0, 0)',
        'border-opacity': 1,
        'border-style': 'solid'
      });
    });

    it('should remove animation data from node', () => {
      // Spy on the removeData method
      const removeDataSpy = vi.spyOn(node, 'removeData');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);

      expect(removeDataSpy).toHaveBeenCalledWith(
        'originalBorderWidth originalBorderColor animationType'
      );
    });

    it('should stop the animation', () => {
      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.stopAnimationForNode(node);

      expect(node.stop).toHaveBeenCalledWith(true, true);
    });
  });

  describe('stopAllAnimations', () => {
    it('should stop animations for all nodes', () => {
      const node2 = cy.add({ data: { id: 'test-node-2' } })[0] as NodeSingular;

      // Mock animate for node2
      vi.spyOn(node2, 'animate').mockImplementation(() => ({
        play: vi.fn().mockReturnThis(),
        promise: vi.fn().mockResolvedValue(undefined)
      } as ReturnType<NodeSingular['animate']>));
      vi.spyOn(node2, 'stop').mockImplementation(() => node2);

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
    it('should clear all timeouts', () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      service.addBreathingAnimation(node, AnimationType.NEW_NODE);
      service.addBreathingAnimation(node, AnimationType.APPENDED_CONTENT);

      service.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});