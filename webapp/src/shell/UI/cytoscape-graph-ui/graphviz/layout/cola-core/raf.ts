interface WindowWithPrefixes extends Window {
  webkitRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  mozRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  msRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

function resolveRaf(): (callback: FrameRequestCallback) => number | void {
  if( typeof window === typeof undefined ){ // if not available, all you get is immediate calls
    return function( cb: FrameRequestCallback ){
      cb(0);
    };
  }
  const win: WindowWithPrefixes = window as unknown as WindowWithPrefixes;
  return ( window.requestAnimationFrame ||
    win.webkitRequestAnimationFrame ||
    win.mozRequestAnimationFrame ||
    win.msRequestAnimationFrame ||
    ((fn: FrameRequestCallback) => setTimeout(fn, 16))
  );
}

const raf: (callback: FrameRequestCallback) => number | void = resolveRaf();

export default raf;
