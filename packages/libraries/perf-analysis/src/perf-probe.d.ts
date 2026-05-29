export function perfProbeFromEnv(svc: string): Promise<undefined | (() => Promise<void>)>
