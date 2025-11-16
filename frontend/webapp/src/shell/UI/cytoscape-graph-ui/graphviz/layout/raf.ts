interface WindowWithPrefixes extends Window {
  webkitRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  mozRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
  msRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

let raf: (callback: FrameRequestCallback) => number | void;

if( typeof window !== typeof undefined ){
  const win = window as unknown as WindowWithPrefixes;
  raf = ( window.requestAnimationFrame ||
    win.webkitRequestAnimationFrame ||
    win.mozRequestAnimationFrame ||
    win.msRequestAnimationFrame ||
    ((fn: FrameRequestCallback) => setTimeout(fn, 16))
  );
} else { // if not available, all you get is immediate calls
  raf = function( cb: FrameRequestCallback ){
    cb(0);
  };
}

export default raf;
