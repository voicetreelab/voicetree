import { getOptVal } from './cola-type-guards';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColaNodes(nonparentNodes: any, options: any, bb: any): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return nonparentNodes.map(function( node: any, i: any ){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const padding: any = getOptVal( options.nodeSpacing, node );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pos: any = node.position();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dimensions: any = node.layoutDimensions( options );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const struct: { x: number; y: number; width: any; height: any; index: any; fixed: any; } = node.scratch().cola = {
            x: (options.randomize && !node.locked()) || pos.x === undefined ? Math.round( Math.random() * bb.w ) : pos.x - bb.x1,
            y: (options.randomize && !node.locked()) || pos.y === undefined ? Math.round( Math.random() * bb.h ) : pos.y - bb.y1,
            width: dimensions.w + 2*padding,
            height: dimensions.h + 2*padding,
            index: i,
            fixed: node.locked()
        };

        // //console.log(`[Cola Debug] Initial setup - GraphNode ${node.relativeFilePathIsID()}: cytoPos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) -> colaPos=(${struct.x.toFixed(2)}, ${struct.y.toFixed(2)}) [bb offset: (${bb.x1}, ${bb.y1})]`);

        return struct;
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColaGroups(parentNodes: any, nonparentNodes: any, options: any): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return parentNodes.map(function( node: any, i: any ){ // add basic group incl leaf nodes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const optPadding: any = getOptVal( options.nodeSpacing, node );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const getPadding: (d: any) => number = function(d: any){
            return parseFloat( node.style('padding-'+d) );
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pleft: any = getPadding('left') + optPadding;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pright: any = getPadding('right') + optPadding;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ptop: any = getPadding('top') + optPadding;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pbottom: any = getPadding('bottom') + optPadding;

        node.scratch().cola = {
            index: i,

            padding: Math.max( pleft, pright, ptop, pbottom ),

            // leaves should only contain direct descendants (children),
            // not the leaves of nested compound nodes or any nodes that are compounds themselves
            leaves: node.children()
                .intersection(nonparentNodes)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map(function( child: any ){
                    return child[0].scratch().cola.index;
                }),

            fixed: node.locked()
        };

        return node;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).map(function( node: any ){ // add subgroups
        node.scratch().cola.groups = node.children()
            .intersection(parentNodes)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map(function( child: any ){
                return child.scratch().cola.index;
            });

        return node.scratch().cola;
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColaEdges(edges: any, nonparentNodes: any, length: any): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return edges.stdFilter(function( edge: any ){
        // Exclude indicator edges from layout calculation
        if (edge.data('isIndicatorEdge')) return false;
        return nonparentNodes.contains(edge.source()) && nonparentNodes.contains(edge.target());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).map(function( edge: any ){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c: any = edge.scratch().cola = {
            source: edge.source()[0].scratch().cola.index,
            target: edge.target()[0].scratch().cola.index
        };

        if( length != null ){
            c.calcLength = getOptVal( length, edge );
        }

        return c;
    });
}
