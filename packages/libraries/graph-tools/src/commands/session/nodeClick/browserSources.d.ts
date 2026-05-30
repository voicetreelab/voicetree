// Type declaration for the hand-written browser-injected source bundle
// (`browserSources.js`). The runtime values are page-evaluated source strings
// plus one timing constant; this declares only the shape `nodeClick.ts` consumes.
export function getBrowserSources(): {
  readonly POST_CLICK_WAIT_MS: number
  readonly COLLECT_BUTTONS_SOURCE: string
  readonly TAKE_RENDERER_SNAPSHOT_SOURCE: string
  readonly BEGIN_CAPTURE_SOURCE: string
  readonly END_CAPTURE_SOURCE: string
}
