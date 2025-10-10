import type { NodeSingular, NodeCollection } from 'cytoscape';

export enum AnimationType {
  PINNED = 'pinned',
  NEW_NODE = 'new_node',
  APPENDED_CONTENT = 'appended_content',
}

interface AnimationConfig {
  duration: number;
  timeout: number;
  expandClass: string;
  contractClass: string;
}

export class BreathingAnimationService {
  private activeAnimations: Map<string, NodeJS.Timeout> = new Map();
  private animationIntervals: Map<string, NodeJS.Timeout> = new Map();
  private configs!: Map<AnimationType, AnimationConfig>;

  constructor() {
    this.configs = new Map([
      [AnimationType.PINNED, {
        duration: 800,
        timeout: 0, // No timeout for pinned
        expandClass: 'breathing-pinned-expand',
        contractClass: 'breathing-pinned-contract',
      }],
      [AnimationType.NEW_NODE, {
        duration: 1000,
        timeout: 0, // No timeout - persists until next node or user interaction
        expandClass: 'breathing-new-expand',
        contractClass: 'breathing-new-contract',
      }],
      [AnimationType.APPENDED_CONTENT, {
        duration: 1200,
        timeout: 10000, // 10 seconds
        expandClass: 'breathing-appended-expand',
        contractClass: 'breathing-appended-contract',
      }],
    ]);
  }

  addBreathingAnimation(nodes: NodeCollection, type: AnimationType = AnimationType.NEW_NODE): void {
    const config = this.configs.get(type)!;

    nodes.forEach((node) => {
      const nodeId = node.id();

      // Stop any existing animation
      this.stopAnimation(nodeId);

      node.data('breathingActive', true);
      node.data('animationType', type);

      // Start animation
      this.animateNode(node, config);

      // Set timeout if needed
      if (config.timeout > 0) {
        const timeout = setTimeout(() => {
          this.stopAnimationForNode(node);
        }, config.timeout);
        this.activeAnimations.set(nodeId, timeout);
      }
    });
  }

  private animateNode(node: NodeSingular, config: AnimationConfig): void {
    if (!node.data('breathingActive')) {
      return;
    }

    const nodeId = node.id();
    let isExpanded = false;

    const toggle = () => {
      if (!node.data('breathingActive')) {
        return;
      }

      // Toggle between expand and contract classes
      if (isExpanded) {
        node.removeClass(config.expandClass);
        node.addClass(config.contractClass);
      } else {
        node.removeClass(config.contractClass);
        node.addClass(config.expandClass);
      }

      isExpanded = !isExpanded;
    };

    // Start with expand state
    toggle();

    // Set up interval to toggle states
    const interval = setInterval(toggle, config.duration);
    this.animationIntervals.set(nodeId, interval);
  }

  stopAnimation(nodeId: string): void {
    // Clear timeout
    const timeout = this.activeAnimations.get(nodeId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeAnimations.delete(nodeId);
    }

    // Clear interval
    const interval = this.animationIntervals.get(nodeId);
    if (interval) {
      clearInterval(interval);
      this.animationIntervals.delete(nodeId);
    }
  }

  stopAnimationForNode(node: NodeSingular): void {
    const nodeId = node.id();

    // Mark as inactive FIRST - this stops new animation cycles from starting
    node.data('breathingActive', false);

    // Get animation type to know which classes to remove
    const animationType = node.data('animationType') as AnimationType | undefined;

    // Clear append animation trigger flag if this was an appended content animation
    if (animationType === AnimationType.APPENDED_CONTENT) {
      node.data('appendAnimationTriggered', false);
    }

    // Stop timers
    this.stopAnimation(nodeId);

    // Remove all breathing animation classes
    if (animationType) {
      const config = this.configs.get(animationType);
      if (config) {
        node.removeClass([config.expandClass, config.contractClass]);
      }
    }

    // Reset border to default by removing inline style overrides
    // This allows the stylesheet cascade to take over (degree-based border, pinned class, etc.)
    node.removeStyle('border-width border-color border-opacity border-style');

    // Clean up data
    node.removeData('animationType');
  }

  stopAllAnimations(nodes: NodeCollection): void {
    nodes.forEach((node) => {
      this.stopAnimationForNode(node);
    });
  }

  /**
   * Sets or updates the timeout for an active animation
   * @param node - The node with an active animation
   * @param timeout - Timeout in milliseconds (0 = no timeout, runs indefinitely)
   */
  setAnimationTimeout(node: NodeSingular, timeout: number): void {
    const nodeId = node.id();

    // Only set timeout if animation is active
    if (!node.data('breathingActive')) {
      return;
    }

    // Clear existing timeout if any
    const existingTimeout = this.activeAnimations.get(nodeId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    if (timeout > 0) {
      const newTimeout = setTimeout(() => {
        this.stopAnimationForNode(node);
      }, timeout);
      this.activeAnimations.set(nodeId, newTimeout);
    } else {
      // Remove timeout (animation runs indefinitely)
      this.activeAnimations.delete(nodeId);
    }
  }

  isAnimationActive(node: NodeSingular): boolean {
    return node.data('breathingActive') === true;
  }

  destroy(): void {
    // Clear all timeouts and intervals
    this.activeAnimations.forEach((timeout) => clearTimeout(timeout));
    this.activeAnimations.clear();
    this.animationIntervals.forEach((interval) => clearInterval(interval));
    this.animationIntervals.clear();
  }
}
