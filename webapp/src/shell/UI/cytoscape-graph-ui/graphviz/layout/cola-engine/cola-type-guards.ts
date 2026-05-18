// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isString: (o: any) => o is string = function(o: any): o is string { return typeof o === typeof ''; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isNumber: (o: any) => o is number = function(o: any): o is number { return typeof o === typeof 0; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isObject: (o: any) => o is object = function(o: any): o is object { return o != null && typeof o === typeof {}; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isFunction: (o: any) => boolean = function(o: any): boolean { return o != null && typeof o === typeof function(){}; };
export const nop: () => void = function(){};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getOptVal: (val: any, ele: any) => any = function( val: any, ele: any ){
    if( isFunction(val) ){
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn: any = val;
        return fn.apply( ele, [ ele ] );
    } else {
        return val;
    }
};
