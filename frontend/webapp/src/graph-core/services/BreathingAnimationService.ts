import type { Core, NodeSingular } from 'cytoscape';

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

/**
 * Simplified breathing animation service using event-driven approach.
 * Listens to cytoscape events and manages animations automatically.
 *
 * Rules:
 * - New nodes: green breathing, no initial timeout
 * - When another new node is added, previous new node gets 15s timeout
 * - Content updates: blue breathing, 15s timeout
 * - Pinned nodes: orange breathing, no timeout
 */
export class BreathingAnimationService {
  private cy: Core;
  private configs: Map<AnimationType, AnimationConfig>;
  private prevNewNode: NodeSingular | null = null;
  private readonly PREV_NODE_TIMEOUT = 15000; // 15 seconds

  constructor(cy: Core) {
    this.cy = cy;

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
        timeout: 15000, // 15 seconds
        expandClass: 'breathing-appended-expand',
        contractClass: 'breathing-appended-contract',
      }],
    ]);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for new nodes
    this.cy.on('add', 'node', (evt) => {
      const node = evt.target;

      // Skip if this is a floating window (has floatingWindow data)
      if (node.data('floatingWindow')) {
        return;
      }

      // If there was a previous new node, give it a timeout
      if (this.prevNewNode && this.prevNewNode.data('breathingActive')) {
        this.setAnimationTimeout(this.prevNewNode, this.PREV_NODE_TIMEOUT);
      }

      // Start green breathing animation on new node
      this.startBreathingAnimation(node, AnimationType.NEW_NODE);

      // Track this as the new prevNewNode
      this.prevNewNode = node;
    });

    // Listen for content updates (custom event emitted by file watcher)
    this.cy.on('content-changed', 'node', (evt) => {
      const node = evt.target;
      this.startBreathingAnimation(node, AnimationType.APPENDED_CONTENT);
    });
  }

  /**
   * Start breathing animation on a node.
   * Used internally by event listeners and externally for pinned nodes.
   */
  startBreathingAnimation(node: NodeSingular, type: AnimationType): void {
    const config = this.configs.get(type)!;

    // Stop any existing animation first
    this.stopAnimationForNode(node);

    // Mark node as breathing
    node.data('breathingActive', true);
    node.data('animationType', type);

    // Start animation by toggling CSS classes
    this.animateNode(node, config);

    // Set timeout if configured
    if (config.timeout > 0) {
      const timeout = setTimeout(() => {
        this.stopAnimationForNode(node);
      }, config.timeout);

      // Store timeout on the node itself
      node.data('_breathingTimeout', timeout);
    }
  }

  private animateNode(node: NodeSingular, config: AnimationConfig): void {
    if (!node.data('breathingActive')) {
      return;
    }

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

    // Store interval on the node itself
    node.data('_breathingInterval', interval);
  }

  stopAnimationForNode(node: NodeSingular): void {
    // Mark as inactive FIRST
    node.data('breathingActive', false);

    // Get animation type to know which classes to remove
    const animationType = node.data('animationType') as AnimationType | undefined;

    // Clear timeout if exists
    const timeout = node.data('_breathingTimeout');
    if (timeout) {
      clearTimeout(timeout);
      node.removeData('_breathingTimeout');
    }

    // Clear interval if exists
    const interval = node.data('_breathingInterval');
    if (interval) {
      clearInterval(interval);
      node.removeData('_breathingInterval');
    }

    // Remove all breathing animation classes
    if (animationType) {
      const config = this.configs.get(animationType);
      if (config) {
        node.removeClass([config.expandClass, config.contractClass]);
      }
    }

    // Reset border to default by removing inline style overrides
    node.removeStyle('border-width border-color border-opacity border-style');

    // Clean up data
    node.removeData('animationType');
  }

  /**
   * Sets or updates the timeout for an active animation.
   * Used to add timeout to previous new node when a newer node is added.
   */
  setAnimationTimeout(node: NodeSingular, timeout: number): void {
    // Only set timeout if animation is active
    if (!node.data('breathingActive')) {
      return;
    }

    // Clear existing timeout if any
    const existingTimeout = node.data('_breathingTimeout');
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    if (timeout > 0) {
      const newTimeout = setTimeout(() => {
        this.stopAnimationForNode(node);
      }, timeout);
      node.data('_breathingTimeout', newTimeout);
    } else {
      // Remove timeout (animation runs indefinitely)
      node.removeData('_breathingTimeout');
    }
  }

  isAnimationActive(node: NodeSingular): boolean {
    return node.data('breathingActive') === true;
  }

  destroy(): void {
    // Stop all animations
    this.cy.nodes().forEach((node) => {
      this.stopAnimationForNode(node);
    });

    // Remove event listeners
    this.cy.off('add', 'node');
    this.cy.off('content-changed', 'node');

    this.prevNewNode = null;
  }

  /**
   * Legacy methods for backward compatibility (used by tests and pinned nodes).
   * These wrap the new event-driven approach.
   */
  addBreathingAnimation(nodes: NodeSingular | import('cytoscape').NodeCollection, type: AnimationType = AnimationType.NEW_NODE): void {
    const nodeArray = 'forEach' in nodes ? Array.from(nodes) : [nodes];

    nodeArray.forEach((node) => {
      this.startBreathingAnimation(node, type);
    });
  }

  stopAllAnimations(nodes: import('cytoscape').NodeCollection): void {
    nodes.forEach((node) => {
      this.stopAnimationForNode(node);
    });
  }

  // Not used anymore, but kept for backward compatibility
  stopAnimation(nodeId: string): void {
    const node = this.cy.getElementById(nodeId);
    if (node.length > 0) {
      this.stopAnimationForNode(node);
    }
  }
}
