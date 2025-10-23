import {type Core, type NodeSingular} from 'cytoscape';

/**
 * SPIKE: Auto-collapse nodes based on edge pixel distance
 * When edges are shorter than threshold pixels, hide children and mark parent
 */
export class ZoomCollapseService {
    private cy: Core;
    private edgeLengthThreshold: number;
    private hiddenNodes: Set<string> = new Set();

    constructor(cy: Core, edgeLengthThreshold = 50) {
        this.cy = cy;
        this.edgeLengthThreshold = edgeLengthThreshold;
    }

    initialize(): void {
        // Listen to viewport changes
        this.cy.on('zoom pan', () => {
            this.updateCollapsedNodes();
        });

        // Initial check
        this.updateCollapsedNodes();
    }

    private updateCollapsedNodes(): void {
        // const nodesToHide = new Set<string>();
        // const parentsWithHiddenChildren = new Set<string>();

        // Check each edge
        this.cy.edges().forEach(edge => {
            const source = edge.source();
            const target = edge.target();

            // Skip ghost root edges
            if (source.data('isGhostRoot') || target.data('isGhostRoot')) {
                return;
            }

            // Calculate pixel distance
            const sourcePos = source.renderedPosition();
            const targetPos = target.renderedPosition();
            const dx = targetPos.x - sourcePos.x;
            const dy = targetPos.y - sourcePos.y;
            const pixelLength = Math.sqrt(dx * dx + dy * dy);

            // Edges go FROM child TO parent (source = child, target = parent)
            // If edge is too short, hide the child (source) and mark parent (target)
            const childId = source.id()
            const parentId = target.id()
            const child: NodeSingular = this.cy.getElementById(childId);
            const parent: NodeSingular = this.cy.getElementById(parentId);

            //todo this has some weird edge cases / race conditions
            if (pixelLength < this.edgeLengthThreshold) {
                // child.style('display', 'none');
                if (!this.hiddenNodes.has(childId)) {
                    // "hide" this child, by eating it
                    this.hiddenNodes.add(childId)
                    this.eatChild(parent, child)
                }

            } else {
                // child.style('display', 'element');
                if (this.hiddenNodes.has(childId)) {
                    // "unhide" this child, reset parent size
                    this.hiddenNodes.delete(childId)
                    this.unEatChild(parent, child)
                }
            }
        });

        // // Hide nodes that should be hidden
        // this.cy.nodes().forEach(node => {
        //     const nodeId = node.id();
        //
        //     if (nodesToHide.has(nodeId) && !this.hiddenNodes.has(nodeId)) {
        //         // Hide this node
        //         node.style('display', 'none');
        //         this.hiddenNodes.add(nodeId);
        //
        //     } else if (!nodesToHide.has(nodeId) && this.hiddenNodes.has(nodeId)) {
        //         // Show this node
        //         node.style('display', 'element');
        //         this.hiddenNodes.delete(nodeId);
        //         node.style('height', 10);
        //         node.style('width', 10);
        //
        //     }
        //
        //     // Mark parent with hidden children
        //     if (parentsWithHiddenChildren.has(nodeId)) {
        //         node.addClass('has-hidden-children');
        //     } else {
        //         node.removeClass('has-hidden-children');
        //     }
        // });
    }

    private eatChild(node: NodeSingular, child: NodeSingular): void {
        const prevHeight = node.height();
        const prevWidth = node.width();
        const childWidth = child.width();
        const childHeight = child.height();
        const prevSize = parseFloat(node.style('font-size'));
        const childSize = parseFloat(node.style('font-size'));
        console.log(prevSize)
        // const nodeDegree = node.degree()
        // node.style('height', prevHeight + Math.max(3, 3*(1/this.cy.zoom())*Math.log(nodeDegree +3)));
        node.style('height', prevHeight + childHeight / 2);
        // node.style('width', prevWidth + Math.max(3, 3*(1/this.cy.zoom())*Math.log(nodeDegree +3)));
        node.style('width', prevWidth + childWidth / 2);
        // node.style('font-size', Math.max(3, 2*Math.round(3*(1/this.cy.zoom())*Math.log(nodeDegree +3))));
        node.style('font-size', prevSize + childSize/3)
        // console.log(this.cy.zoom(), Math.log(nodeDegree +3), Math.log(this.cy.zoom() +3) );

    }

    private unEatChild(node: NodeSingular, child: NodeSingular): void {
        const prevHeight = node.height();
        const prevWidth = node.width();
        const childWidth = child.width();
        const childHeight = child.height();
        // const nodeDegree = node.degree()
        const prevSize = parseFloat(node.style('font-size'));
        const childSize = parseFloat(node.style('font-size'));

        // node.style('height', prevHeight - Math.max(3, 3*(1/this.cy.zoom())*Math.log(nodeDegree +3)));
        // node.style('width', prevWidth - Math.max(3, 3*(1/this.cy.zoom())*Math.log(nodeDegree +3)));

        node.style('height', Math.max(childHeight, prevHeight - childHeight / 2));
        node.style('width', Math.max(childWidth, prevWidth - childWidth / 2));
        node.style('font-size', Math.max(15, prevSize - childSize/3))
    }


    destroy(): void {
        this.cy.off('zoom pan');
        // Restore all hidden nodes
        this.cy.nodes().forEach(node => {
            node.style('display', 'element');
            node.removeClass('has-hidden-children');
        });
        this.hiddenNodes.clear();
    }
}
