import assign from './assign';
import defaults from './defaults';
import * as cola from 'webcola';
import raf from './raf';

const isString = function(o){ return typeof o === typeof ''; };
const isNumber = function(o){ return typeof o === typeof 0; };
const isObject = function(o){ return o != null && typeof o === typeof {}; };
const isFunction = function(o){ return o != null && typeof o === typeof function(){}; };
const nop = function(){};

const getOptVal = function( val, ele ){
    if( isFunction(val) ){
        const fn = val;
        return fn.apply( ele, [ ele ] );
    } else {
        return val;
    }
};

// constructor
// options : object containing layout options
function ColaLayout( options ){
    this.options = assign( {}, defaults, options );
    this._listeners = {}; // Simple event emitter storage
}

// Simple event emitter methods
ColaLayout.prototype.on = function(event, callback){
    if (!this._listeners[event]) {
        this._listeners[event] = [];
    }
    this._listeners[event].push(callback);
    return this;
};

ColaLayout.prototype.one = function(event, callback){
    const wrapper = (...args) => {
        callback(...args);
        this.off(event, wrapper);
    };
    this.on(event, wrapper);
    return this;
};

ColaLayout.prototype.off = function(event, callback){
    if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
    return this;
};

ColaLayout.prototype.trigger = function(data){
    const event = data.type || data;
    if (this._listeners[event]) {
        this._listeners[event].forEach(callback => callback(data));
    }
    return this;
};

// runs the layout
ColaLayout.prototype.run = function(){
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const layout = this;
    const options = this.options;

    layout.manuallyStopped = false;

    const cy = options.cy; // cy is automatically populated for us in the constructor
    const eles = options.eles;
    const nodes = eles.nodes();
    const edges = eles.edges();
    let ready = false;

    const isParent = ele => ele.isParent();

    const parentNodes = nodes.filter(isParent);

    const nonparentNodes = nodes.subtract(parentNodes);

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

    const bb = { x1: 0, y1: 0, w: cy.width(), h: cy.height(), x2: cy.width(), y2: cy.height() };

    // console.log('[Cola Debug] Bounding box:', bb);

    let updatePositionCallCount = 0;
    const updateNodePositions = function(){
        updatePositionCallCount++;
        const isFirstThreeCalls = updatePositionCallCount <= 3;

        // if (isFirstThreeCalls) {
        //     console.log(`[Cola Debug] updateNodePositions call #${updatePositionCallCount}`);
        // }

        for( let i = 0; i < nodes.length; i++ ){
            const node = nodes[i];
            const dimensions = node.layoutDimensions( options );
            const scratch = node.scratch('cola');

            // update node dims
            if( !scratch.updatedDims ){
                const padding = getOptVal( options.nodeSpacing, node );

                scratch.width = dimensions.w + 2*padding;
                scratch.height = dimensions.h + 2*padding;
            }
        }

        nodes.positions(function(node){
            const scratch = node.scratch().cola;
            let retPos;

            if( !node.grabbed() && nonparentNodes.contains(node) ){
                retPos = {
                    x: bb.x1 + scratch.x,
                    y: bb.y1 + scratch.y
                };

                if( !isNumber(retPos.x) || !isNumber(retPos.y) ){
                    retPos = undefined;
                }

                if (isFirstThreeCalls && retPos) {
                    const currentPos = node.position();
                    // console.log(`[Cola Debug]   Node ${node.relativeFilePathIsID()}: scratch=(${scratch.x.toFixed(2)}, ${scratch.y.toFixed(2)}) -> retPos=(${retPos.x.toFixed(2)}, ${retPos.y.toFixed(2)}) [was (${currentPos.x.toFixed(2)}, ${currentPos.y.toFixed(2)})]`);
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

    const onDone = function(){
        if( options.ungrabifyWhileSimulating ){
            grabbableNodes.grabify();
        }

        cy.off('destroy', destroyHandler);

        nodes.off('grab free position', grabHandler);
        nodes.off('lock unlock', lockHandler);

        // trigger layoutstop when the layout stops (e.g. finishes)
        layout.one('layoutstop', options.stop);
        layout.trigger({ type: 'layoutstop', layout: layout });
    };

    const onReady = function(){
        // trigger layoutready when each node has had its position set at least once
        layout.one('layoutready', options.ready);
        layout.trigger({ type: 'layoutready', layout: layout });
    };

    let ticksPerFrame = options.refresh;

    if( options.refresh < 0 ){
        ticksPerFrame = 1;
    } else {
        ticksPerFrame = Math.max( 1, ticksPerFrame ); // at least 1
    }

    const adaptor = layout.adaptor = cola.adaptor({
        trigger: function( e ){ // on sim event
            const TICK = cola.EventType ? cola.EventType.tick : null;
            const END = cola.EventType ? cola.EventType.end : null;

            switch( e.type ){
                case 'tick':
                case TICK:
                    if( options.animate ){
                        updateNodePositions();
                    }
                    break;

                case 'end':
                case END:
                    console.log('[Cola] Layout ended due to CONVERGENCE');
                    updateNodePositions();
                    if( !options.infinite ){ onDone(); }
                    break;
            }
        },

        kick: function(){ // kick off the simulation
            //let skip = 0;

            let firstTick = true;
            let tickCount = 0;

            const inftick = function(){
                if( layout.manuallyStopped ){
                    onDone();

                    return true;
                }

                tickCount++;
                const isFirstThreeTicks = tickCount <= 3;

                if (isFirstThreeTicks) {
                    // console.log(`[Cola Debug] ====== Tick #${tickCount} START ======`);
                }

                const ret = adaptor.tick();

                if (isFirstThreeTicks) {
                    // console.log(`[Cola Debug] ====== Tick #${tickCount} END (converged: ${ret}) ======`);
                }

                if( !options.infinite && !firstTick ){
                    adaptor.convergenceThreshold(options.convergenceThreshold);
                }

                // Log convergence status every 50 ticks
                if( !options.infinite && adaptor.alpha && Math.random() < 0.02 ){
                    console.log('[Cola] Energy (alpha):', adaptor.alpha(), 'threshold:', options.convergenceThreshold);
                }

                firstTick = false;

                if( ret && options.infinite ){ // resume layout if done
                    adaptor.resume(); // resume => new kick
                }

                return ret; // allow regular finish b/c of new kick
            };

            const multitick = function(){ // multiple ticks in a row
                let ret;

                for( let i = 0; i < ticksPerFrame && !ret; i++ ){
                    ret = ret || inftick(); // pick up true ret vals => sim done
                }

                return ret;
            };

            if( options.animate ){
                const frame = function(){
                    if( multitick() ){ return; }

                    raf( frame );
                };

                raf( frame );
            } else {
                while( !inftick() ){
                    // keep going...
                }
            }
        },

        on: nop, // dummy; not needed

        drag: nop // not needed for our case
    });
    layout.adaptor = adaptor;

    // if set no grabbing during layout
    const grabbableNodes = nodes.filter(':grabbable');
    if( options.ungrabifyWhileSimulating ){
        grabbableNodes.ungrabify();
    }

    let destroyHandler;
    cy.one('destroy', destroyHandler = function(){
        layout.stop();
    });

    // handle node dragging
    let grabHandler;
    nodes.on('grab free position', grabHandler = function(e){
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const node = this;
        const scrCola = node.scratch().cola;
        const pos = node.position();
        const nodeIsTarget = e.cyTarget === node || e.target === node;

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

    let lockHandler;
    nodes.on('lock unlock', lockHandler = function(){
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const node = this;
        const scrCola = node.scratch().cola;

        scrCola.fixed = node.locked();

        if( node.locked() ){
            adaptor.dragstart( scrCola );
        } else {
            adaptor.dragend( scrCola );
        }
    });

    // add nodes to cola
    adaptor.nodes( nonparentNodes.map(function( node, i ){
        const padding = getOptVal( options.nodeSpacing, node );
        const pos = node.position();
        const dimensions = node.layoutDimensions( options );

        const struct = node.scratch().cola = {
            x: (options.randomize && !node.locked()) || pos.x === undefined ? Math.round( Math.random() * bb.w ) : pos.x - bb.x1,
            y: (options.randomize && !node.locked()) || pos.y === undefined ? Math.round( Math.random() * bb.h ) : pos.y - bb.y1,
            width: dimensions.w + 2*padding,
            height: dimensions.h + 2*padding,
            index: i,
            fixed: node.locked()
        };

        // console.log(`[Cola Debug] Initial setup - Node ${node.relativeFilePathIsID()}: cytoPos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}) -> colaPos=(${struct.x.toFixed(2)}, ${struct.y.toFixed(2)}) [bb offset: (${bb.x1}, ${bb.y1})]`);

        return struct;
    }) );

    // the constraints to be added on nodes
    const constraints = [];

    if( options.alignment ){ // then set alignment constraints

        if(options.alignment.vertical) {
            const verticalAlignments = options.alignment.vertical;
            verticalAlignments.forEach(function(alignment){
                const offsetsX = [];
                alignment.forEach(function(nodeData){
                    const node = nodeData.node;
                    const scrCola = node.scratch().cola;
                    const index = scrCola.index;
                    offsetsX.push({
                        node: index,
                        offset: nodeData.offset ? nodeData.offset : 0
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
            const horizontalAlignments = options.alignment.horizontal;
            horizontalAlignments.forEach(function(alignment){
                const offsetsY = [];
                alignment.forEach(function(nodeData){
                    const node = nodeData.node;
                    const scrCola = node.scratch().cola;
                    const index = scrCola.index;
                    offsetsY.push({
                        node: index,
                        offset: nodeData.offset ? nodeData.offset : 0
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
        options.gapInequalities.forEach( inequality => {

            // for the constraints to be passed to cola layout adaptor use indices of nodes,
            // not the nodes themselves
            const leftIndex = inequality.left.scratch().cola.index;
            const rightIndex = inequality.right.scratch().cola.index;

            constraints.push({
                axis: inequality.axis,
                left: leftIndex,
                right: rightIndex,
                gap: inequality.gap,
                equality: inequality.equality
            });

        } );
    }

    // add constraints if any
    if ( constraints.length > 0 ) {
        adaptor.constraints( constraints );
    }

    // add compound nodes to cola
    adaptor.groups( parentNodes.map(function( node, i ){ // add basic group incl leaf nodes
        const optPadding = getOptVal( options.nodeSpacing, node );
        const getPadding = function(d){
            return parseFloat( node.style('padding-'+d) );
        };

        const pleft = getPadding('left') + optPadding;
        const pright = getPadding('right') + optPadding;
        const ptop = getPadding('top') + optPadding;
        const pbottom = getPadding('bottom') + optPadding;

        node.scratch().cola = {
            index: i,

            padding: Math.max( pleft, pright, ptop, pbottom ),

            // leaves should only contain direct descendants (children),
            // not the leaves of nested compound nodes or any nodes that are compounds themselves
            leaves: node.children()
                .intersection(nonparentNodes)
                .map(function( child ){
                    return child[0].scratch().cola.index;
                }),

            fixed: node.locked()
        };

        return node;
    }).map(function( node ){ // add subgroups
        node.scratch().cola.groups = node.children()
            .intersection(parentNodes)
            .map(function( child ){
                return child.scratch().cola.index;
            });

        return node.scratch().cola;
    }) );

    // get the edge length setting mechanism
    let length;
    let lengthFnName;
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

    const lengthGetter = function( link ){
        return link.calcLength;
    };

    // add the outgoingEdges to cola
    adaptor.links( edges.stdFilter(function( edge ){
        return nonparentNodes.contains(edge.source()) && nonparentNodes.contains(edge.target());
    }).map(function( edge ){
        const c = edge.scratch().cola = {
            source: edge.source()[0].scratch().cola.index,
            target: edge.target()[0].scratch().cola.index
        };

        if( length != null ){
            c.calcLength = getOptVal( length, edge );
        }

        return c;
    }) );

    adaptor.size([ bb.w, bb.h ]);

    if( length != null ){
        adaptor[ lengthFnName ]( lengthGetter );
    }

    // set the flow of cola
    if( options.flow ){
        let flow;
        const defAxis = 'y';
        const defMinSep = 50;

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

            flow.axis = flow.axis || defAxis;
            flow.minSeparation = flow.minSeparation != null ? flow.minSeparation : defMinSep;
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
                console.log('[Cola] Layout ended due to TIMEOUT after', options.maxSimulationTime, 'ms');
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