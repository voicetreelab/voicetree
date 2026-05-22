// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColaConstraints(options: any): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constraints: any[] = [];

    if( options.alignment ){ // then set alignment constraints

        if(options.alignment.vertical) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const verticalAlignments: any = options.alignment.vertical;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            verticalAlignments.forEach(function(alignment: any){
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const offsetsX: any[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                alignment.forEach(function(nodeData: any){
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const node: any = nodeData.node;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const scrCola: any = node.scratch().cola;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const index: any = scrCola.index;
                    offsetsX.push({
                        node: index,
                        offset: nodeData.offset ?? 0
                    });
                });
                constraints.push({
                    type: 'alignment',
                    axis: 'x',
                    offsets: offsetsX
                });
            });
        }

        if(options.alignment.horizontal) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const horizontalAlignments: any = options.alignment.horizontal;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            horizontalAlignments.forEach(function(alignment: any){
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const offsetsY: any[] = [];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                alignment.forEach(function(nodeData: any){
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const node: any = nodeData.node;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const scrCola: any = node.scratch().cola;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const index: any = scrCola.index;
                    offsetsY.push({
                        node: index,
                        offset: nodeData.offset ?? 0
                    });
                });
                constraints.push({
                    type: 'alignment',
                    axis: 'y',
                    offsets: offsetsY
                });
            });
        }

    }

    // if gapInequalities variable is set add each inequality constraint to list of constraints
    if ( options.gapInequalities ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options.gapInequalities.forEach( (inequality: any) => {

            // for the constraints to be passed to cola layout adaptor use indices of nodes,
            // not the nodes themselves
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const leftIndex: any = inequality.left.scratch().cola.index;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rightIndex: any = inequality.right.scratch().cola.index;

            constraints.push({
                axis: inequality.axis,
                left: leftIndex,
                right: rightIndex,
                gap: inequality.gap,
                equality: inequality.equality
            });

        } );
    }

    return constraints;
}
