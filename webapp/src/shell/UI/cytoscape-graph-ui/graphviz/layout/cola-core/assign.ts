// Simple, internal Object.assign() polyfill for options objects etc.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default Object.assign != null ? Object.assign.bind( Object ) : function( tgt: any, ...srcs: any[] ){
  srcs.filter(src => src != null).forEach( src => {
    Object.keys( src ).forEach( k => tgt[k] = src[k] );
  } );

  return tgt;
};
