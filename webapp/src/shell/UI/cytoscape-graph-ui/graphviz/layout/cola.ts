import assign from './assign';
import defaults from './defaults';
import * as cola from 'webcola';
import raf from './raf';
import { isNumber, isString, isObject, nop, getOptVal } from './cola-type-guards';
import { applyColaEventEmitter } from './cola-event-emitter';
import { buildColaConstraints } from './cola-constraints';
import { buildColaNodes, buildColaGroups, buildColaEdges } from './cola-node-setup';

// constructor
// options : object containing layout options
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ColaLayout( this: any, options: any ): any {
    this.options = assign( {}, defaults, options );
    this._listeners = {}; // Simple event emitter storage
}

// Simple event emitter methods
applyColaEventEmitter(ColaLayout);

// runs the layout
ColaLayout.prototype.run = function(){
    // eslint-disable-next-line @typescript-eslint/no-this-alias, @typescript-eslint/no-explicit-any
    const layout: any = this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = this.options;

    layout.manuallyStopped = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy: any = options.cy; // cy is automatically populated for us in the constructor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eles: any = options.eles;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes: any = eles.nodes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edges: any = eles.edges();
    let ready: boolean = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isParent: (ele: any) => any = (ele: any) => ele.isParent();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentNodes: any = nodes.filter(isParent);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonparentNodes: any = nodes.subtract(parentNodes);

    // TODO: Investigate bounding box offset causing graph flicker when adding nodes
    // The bb.x1/bb.y1 offset transformation causes nodes to jump positions when the bounding box
    // changes between layout runs (e.g., when adding a new node at the edge of the graph).
    // For now, forcing bb.x1=0, bb.y1=0 to prevent flicker.
    // Original code:
    // const bb = options.boundingBox || { x1: 0, y1: 0, w: cy.width(), h: cy.height() };
    // if( bb.x2 === undefined ){ bb.x2 = bb.x1 + bb.w; }
    // if( bb.w === undefined ){ bb.w = bb.x2 - bb.x1; }
    // if( bb.y2 === undefined ){ bb.y2 = bb.y1 + bb.h; }
    // if( bb.h === undefined ){ bb.h = bb.y2 - bb.y1; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bb: { x1: number; y1: number; w: any; h: any; x2: any; y2: any; } = { x1: 0, y1: 0, w: cy.width(), h: cy.height(), x2: cy.width(), y2: cy.height() };

    // //console.log('[Cola Debug] Bounding box:', bb);

    let updatePositionCallCount: number = 0;
    const updateNodePositions: () => void = function(){
        updatePositionCallCount++;
        const isFirstThreeCalls: boolean = updatePositionCallCount <= 3;

        // if (isFirstThreeCalls) {
        //     //console.log(`[Cola Debug] updateNodePositions call #${updatePositionCallCount}`);
        // }

        for( let i: number = 0; i < nodes.length; i++ ){
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node: any = nodes[i];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dimensions: any = node.layoutDimensions( options );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const scratch: any = node.scratch('cola');

            // update node dims
            if( !scratch.updatedDims ){
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const padding: any = getOptVal( options.nodeSpacing, node );

                scratch.width = dimensions.w + 2*padding;
                scratch.height = dimensions.h + 2*padding;
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodes.positions(function(node: any){
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const scratch: any = node.scratch().cola;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let retPos: any;

            if( !node.grabbed() && nonparentNodes.contains(node) ){
                retPos = {
                    x: bb.x1 + scratch.x,
                    y: bb.y1 + scratch.y
                };

                if( !isNumber(retPos.x) || !isNumber(retPos.y) ){
                    retPos = undefined;
                }

                if (isFirstThreeCalls && retPos) {
                    // //console.log(`[Cola Debug]   GraphNode ${node.relativeFilePathIsID()}: scratch=(${scratch.x.toFixed(2)}, ${scratch.y.toFixed(2)}) -> retPos=(${retPos.x.toFixed(2)}, ${retPos.y.toFixed(2)}) [was (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)})]`);
                }
            }

            return retPos;
        });

        nodes.updateCompoundBounds(); // because the way this layout sets positions is buggy for some reason; ref #878

        if( !ready ){
            onReady();
            ready = true;
        }

        if( options.fit ){
            cy.fit( options.padding );
        }
    };

    const onDone: () => void = function(){
        if( options.ungrabifyWhileSimulating ){
            grabbableNodes.grabify();
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cy.off('destroy', destroyHandler as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodes.off('grab free position', grabHandler as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodes.off('lock unlock', lockHandler as any);

        // trigger layoutstop when the layout stops (e.g. finishes)
        layout.one('layoutstop', options.stop);
        layout.trigger({ type: 'layoutstop', layout: layout });
    };

    const onReady: () => void = function(){
        // trigger layoutready when each node has had its position set at least once
        layout.one('layoutready', options.ready);
        layout.trigger({ type: 'layoutready', layout: layout });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ticksPerFrame: any = options.refresh;

    if( options.refresh < 0 ){
        ticksPerFrame = 1;
    } else {
        ticksPerFrame = Math.max( 1, ticksPerFrame ); // at least 1
    }

    const adaptor: cola.LayoutAdaptor = layout.adaptor = cola.adaptor({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trigger: function( e: any ){ // on sim event
            const TICK: cola.EventType.tick | null = cola.EventType ? cola.EventType.tick : null;
            const END: cola.EventType.end | null = cola.EventType ? cola.EventType.end : null;

            switch( e.type ){
                case 'tick':
                case TICK:
                    if( options.animate ){
                        updateNodePositions();
                    }
                    break;

                case 'end':
                case END:
                    //console.log('[Cola] Layout ended due to CONVERGENCE');
                    updateNodePositions();
                    if( !options.infinite ){ onDone(); }
                    break;
            }
        },

        kick: function(){ // kick off the simulation
            //let skip = 0;

            let firstTick: boolean = true;
            let tickCount: number = 0;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inftick: () => any = function(){
                if( layout.manuallyStopped ){
                    onDone();

                    return true;
                }

                tickCount++;
                const isFirstThreeTicks: boolean = tickCount <= 3;

                if (isFirstThreeTicks) {
                    // //console.log(`[Cola Debug] ====== Tick #${tickCount} START ======`);
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ret: any = (adaptor as any).tick();

                if (isFirstThreeTicks) {
                    // //console.log(`[Cola Debug] ====== Tick #${tickCount} END (converged: ${ret}) ======`);
                }

                if( !options.infinite && !firstTick ){
                    adaptor.convergenceThreshold(options.convergenceThreshold);
                }

                // Log convergence status every 50 ticks
                if( !options.infinite && adaptor.alpha() && Math.random() < 0.02 ){
                    //console.log('[Cola] Energy (alpha):', adaptor.alpha(), 'threshold:', options.convergenceThreshold);
                }

                firstTick = false;

                if( ret && options.infinite ){ // resume layout if done
                    adaptor.resume(); // resume => new kick
                }

                return ret; // allow regular finish b/c of new kick
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const multitick: () => any = function(){ // multiple ticks in a row
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let ret: any;

                for( let i: number = 0; i < ticksPerFrame && !ret; i++ ){
                    ret = ret ?? inftick(); // pick up true ret vals => sim done
                }

                return ret;
            };

            if( options.animate ){
                const frame: () => void = function(){
                    if( multitick() ){ return; }

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (raf as any)( frame );
                };

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (raf as any)( frame );
            } else {
                const MAX_SYNC_ITERATIONS: number = 500;
                let syncIter: number = 0;
                while( !inftick() && ++syncIter < MAX_SYNC_ITERATIONS ){
                    // keep going...
                }
            }
        },

        on: nop, // dummy; not needed

        drag: nop // not needed for our case
    });
    layout.adaptor = adaptor;

    // if set no grabbing during layout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grabbableNodes: any = nodes.filter(':grabbable');
    if( options.ungrabifyWhileSimulating ){
        grabbableNodes.ungrabify();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let destroyHandler: any;
    cy.one('destroy', destroyHandler = function(){
        layout.stop();
    });

    // handle node dragging
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grabHandler: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.on('grab free position', grabHandler = function(this: any, e: any){
        // eslint-disable-next-line @typescript-eslint/no-this-alias, @typescript-eslint/no-explicit-any
        const node: any = this;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scrCola: any = node.scratch().cola;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pos: any = node.position();
        const nodeIsTarget: boolean = e.cyTarget === node || e.target === node;

        if( !nodeIsTarget ){ return; }

        switch( e.type ){
            case 'grab':
                adaptor.dragstart( scrCola );
                break;
            case 'free':
                adaptor.dragend( scrCola );
                break;
            case 'position':
                // only update when different (i.e. manual .position() call or drag) so we don't loop needlessly
                if( scrCola.px !== pos.x - bb.x1 || scrCola.py !== pos.y - bb.y1 ){
                    scrCola.px = pos.x - bb.x1;
                    scrCola.py = pos.y - bb.y1;
                }
                break;
        }

    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lockHandler: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.on('lock unlock', lockHandler = function(this: any){
        // eslint-disable-next-line @typescript-eslint/no-this-alias, @typescript-eslint/no-explicit-any
        const node: any = this;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const scrCola: any = node.scratch().cola;

        scrCola.fixed = node.locked();

        if( node.locked() ){
            adaptor.dragstart( scrCola );
        } else {
            adaptor.dragend( scrCola );
        }
    });

    // add nodes to cola
    adaptor.nodes( buildColaNodes(nonparentNodes, options, bb) );

    // the constraints to be added on nodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constraints: any[] = buildColaConstraints(options);

    // add constraints if any
    if ( constraints.length > 0 ) {
        adaptor.constraints( constraints );
    }

    // add compound nodes to cola
    adaptor.groups( buildColaGroups(parentNodes, nonparentNodes, options) );

    // get the edge length setting mechanism
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let length: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lengthFnName: any;
    if( options.edgeLength != null ){
        length = options.edgeLength;
        lengthFnName = 'linkDistance';
    } else if( options.edgeSymDiffLength != null ){
        length = options.edgeSymDiffLength;
        lengthFnName = 'symmetricDiffLinkLengths';
    } else if( options.edgeJaccardLength != null ){
        length = options.edgeJaccardLength;
        lengthFnName = 'jaccardLinkLengths';
    } else {
        length = 100;
        lengthFnName = 'linkDistance';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lengthGetter: (link: any) => any = function( link: any ){
        return link.calcLength;
    };

    // add the outgoingEdges to cola
    adaptor.links( buildColaEdges(edges, nonparentNodes, length) );

    adaptor.size([ bb.w, bb.h ]);

    if( length != null ){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (adaptor as any)[ lengthFnName ]( lengthGetter );
    }

    // set the flow of cola
    if( options.flow ){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let flow: any;
        const defAxis: "y" = 'y' as const;
        const defMinSep: 50 = 50 as const;

        if( isString(options.flow) ){
            flow = {
                axis: options.flow,
                minSeparation: defMinSep
            };
        } else if( isNumber(options.flow) ){
            flow = {
                axis: defAxis,
                minSeparation: options.flow
            };
        } else if( isObject(options.flow) ){
            flow = options.flow;

            flow.axis = flow.axis ?? defAxis;
            flow.minSeparation = flow.minSeparation ?? defMinSep;
        } else { // e.g. options.flow: true
            flow = {
                axis: defAxis,
                minSeparation: defMinSep
            };
        }

        adaptor.flowLayout( flow.axis , flow.minSeparation );
    }

    layout.trigger({ type: 'layoutstart', layout: layout });

    adaptor
        .avoidOverlaps( options.avoidOverlap )
        .handleDisconnected( options.handleDisconnected )
        .start(
            options.unconstrIter,
            options.userConstIter,
            options.allConstIter,
            undefined, // gridSnapIterations = 0
            undefined, // keepRunning = true
            options.centerGraph
        )
    ;

    if( !options.infinite ){
        setTimeout(function(){
            if( !layout.manuallyStopped ){
                //console.log('[Cola] Layout ended due to TIMEOUT after', options.maxSimulationTime, 'ms');
                adaptor.stop();
            }
        }, options.maxSimulationTime);
    }

    return this; // chaining
};

// called on continuous layouts to stop them before they finish
ColaLayout.prototype.stop = function(){
    if( this.adaptor ){
        this.manuallyStopped = true;
        this.adaptor.stop();
    }

    return this; // chaining
};

export default ColaLayout;
