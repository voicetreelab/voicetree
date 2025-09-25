import type {
  PositioningStrategy,
  PositioningContext,
  PositioningResult,
  Position,
  NodeInfo,
  StrategyConfig
} from './types';

export class SeedParkRelaxStrategy implements PositioningStrategy {
  name = 'seed-park-relax';

  private config: Required<StrategyConfig> = {
    targetLength: 120,
    edgeLenTolerance: 0.25,
    microRelaxIters: 15,
    springK: 1.0,
    repelK: 0.5,
    stepSize: 0.15,
    localRadiusMult: 3
  };

  constructor(config?: StrategyConfig) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  position(context: PositioningContext): PositioningResult {
    const positions = new Map<string, Position>();

    for (const node of context.newNodes) {
      // Phase 1: SEED
      const seedPos = this.seed(node, context);

      // Phase 2: PARK
      const parkedPos = this.park(seedPos, node, context, positions);

      // Phase 3: MICRO-RELAX
      const relaxedPos = this.microRelax(parkedPos, node, context, positions);

      positions.set(node.id, relaxedPos);
    }

    return { positions };
  }

  private seed(node: NodeInfo, context: PositioningContext): Position {
    // Find connected nodes from existing nodes
    const connectedNodes = context.nodes.filter(n =>
      node.linkedNodeIds.includes(n.id) ||
      n.linkedNodeIds.includes(node.id)
    );

    if (connectedNodes.length === 0) {
      // No connections - place near center of mass
      if (context.nodes.length === 0) {
        return {
          x: (context.bounds?.width || 800) / 2,
          y: (context.bounds?.height || 600) / 2
        };
      }

      let cx = 0, cy = 0;
      context.nodes.forEach(n => {
        cx += n.position.x;
        cy += n.position.y;
      });
      return {
        x: cx / context.nodes.length,
        y: cy / context.nodes.length
      };
    }

    // Single parent - place at optimal angle
    if (connectedNodes.length === 1) {
      const parent = connectedNodes[0];
      const parentPos = parent.position;

      // Find occupied angles from parent
      const occupiedAngles: number[] = [];
      context.nodes.forEach(n => {
        if (n.id !== parent.id && parent.linkedNodeIds.includes(n.id)) {
          const angle = Math.atan2(
            n.position.y - parentPos.y,
            n.position.x - parentPos.x
          );
          occupiedAngles.push(angle);
        }
      });

      // Find best angle (furthest from occupied)
      let bestAngle = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * 2 * Math.PI;
        let minDist = Math.PI;

        for (const occupied of occupiedAngles) {
          const diff = Math.abs(angle - occupied);
          minDist = Math.min(minDist, Math.min(diff, 2 * Math.PI - diff));
        }

        if (minDist > bestScore) {
          bestScore = minDist;
          bestAngle = angle;
        }
      }

      return {
        x: parentPos.x + Math.cos(bestAngle) * this.config.targetLength,
        y: parentPos.y + Math.sin(bestAngle) * this.config.targetLength
      };
    }

    // Multiple connections - weighted barycenter
    let sx = 0, sy = 0, sw = 0;
    connectedNodes.forEach(n => {
      const w = 1 / Math.max(this.config.targetLength, 1);
      sx += n.position.x * w;
      sy += n.position.y * w;
      sw += w;
    });

    return { x: sx / sw, y: sy / sw };
  }

  private park(
    seedPos: Position,
    node: NodeInfo,
    context: PositioningContext,
    currentPositions: Map<string, Position>
  ): Position {
    const nodeRadius = Math.max(node.size.width, node.size.height) / 2 + 20; // Add extra padding
    const maxTries = 48; // More attempts

    // Check if position overlaps with any existing node
    const overlaps = (pos: Position): boolean => {
      // Check against existing nodes
      for (const existing of context.nodes) {
        const existingRadius = Math.max(existing.size.width, existing.size.height) / 2 + 20;
        const dist = Math.hypot(
          pos.x - existing.position.x,
          pos.y - existing.position.y
        );
        if (dist < nodeRadius + existingRadius) {
          return true;
        }
      }

      // Check against already positioned new nodes
      for (const [id, existingPos] of currentPositions) {
        const existingNode = context.newNodes.find(n => n.id === id);
        if (!existingNode) continue;

        const existingRadius = Math.max(existingNode.size.width, existingNode.size.height) / 2 + 20;
        const dist = Math.hypot(pos.x - existingPos.x, pos.y - existingPos.y);
        if (dist < nodeRadius + existingRadius) {
          return true;
        }
      }

      return false;
    };

    // First check if seed position is good
    if (!overlaps(seedPos)) {
      return seedPos;
    }

    // Spiral search for non-overlapping position
    for (let k = 0; k < maxTries; k++) {
      const ring = (nodeRadius * 2) + 20 * Math.floor(k / 12);
      const theta = (2 * Math.PI * k) / 12;
      const candidate = {
        x: seedPos.x + ring * Math.cos(theta),
        y: seedPos.y + ring * Math.sin(theta)
      };

      if (!overlaps(candidate)) {
        return candidate;
      }
    }

    // If still no good spot, try a larger radius
    const largeRadius = nodeRadius * 4;
    for (let k = 0; k < 12; k++) {
      const theta = (2 * Math.PI * k) / 12;
      const candidate = {
        x: seedPos.x + largeRadius * Math.cos(theta),
        y: seedPos.y + largeRadius * Math.sin(theta)
      };
      if (!overlaps(candidate)) {
        return candidate;
      }
    }

    // Fallback to seed if no spot found
    return seedPos;
  }

  private microRelax(
    pos: Position,
    node: NodeInfo,
    context: PositioningContext,
    currentPositions: Map<string, Position>
  ): Position {
    let currentPos = { ...pos };
    const nodeRadius = Math.max(node.size.width, node.size.height) / 2 + 20;
    const localRadius = this.config.localRadiusMult * nodeRadius * 2;

    for (let iter = 0; iter < this.config.microRelaxIters; iter++) {
      let fx = 0, fy = 0;

      // Springs to connected nodes
      const connectedNodes = context.nodes.filter(n =>
        node.linkedNodeIds.includes(n.id) ||
        n.linkedNodeIds.includes(node.id)
      );

      connectedNodes.forEach(connected => {
        const dx = currentPos.x - connected.position.x;
        const dy = currentPos.y - connected.position.y;
        const dist = Math.hypot(dx, dy) || 1;
        const delta = dist - this.config.targetLength;

        fx -= this.config.springK * delta * (dx / dist);
        fy -= this.config.springK * delta * (dy / dist);
      });

      // Local repulsion from nearby nodes
      const allNodes = [
        ...context.nodes.map(n => ({ pos: n.position, radius: Math.max(n.size.width, n.size.height) / 2 + 20 })),
        ...[...currentPositions.entries()]
          .filter(([id]) => id !== node.id)
          .map(([id, pos]) => {
            const n = context.newNodes.find(nn => nn.id === id);
            return { pos, radius: n ? Math.max(n.size.width, n.size.height) / 2 + 20 : 40 };
          })
      ];

      allNodes.forEach(({ pos: otherPos, radius: otherRadius }) => {
        const dx = currentPos.x - otherPos.x;
        const dy = currentPos.y - otherPos.y;
        const dist2 = dx * dx + dy * dy + 1e-6;
        const dist = Math.sqrt(dist2);

        if (dist < localRadius) {
          const minDist = nodeRadius + otherRadius;
          if (dist < minDist) {
            // Very strong repulsion when overlapping
            const factor = this.config.repelK * 5;
            const pushDist = minDist - dist + 5;
            fx += factor * pushDist * (dx / dist);
            fy += factor * pushDist * (dy / dist);
          } else {
            // Normal repulsion when nearby
            fx += this.config.repelK * dx / dist2;
            fy += this.config.repelK * dy / dist2;
          }
        }
      });

      // Update position with clamped step
      const forceMag = Math.hypot(fx, fy);
      const maxStep = nodeRadius * 0.5;
      const step = Math.min(this.config.stepSize, maxStep / Math.max(forceMag, 1e-6));

      currentPos.x += step * fx;
      currentPos.y += step * fy;

      // Early exit if movement is tiny
      if (step * forceMag < nodeRadius * 0.01) {
        break;
      }
    }

    return currentPos;
  }
}