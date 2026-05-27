// Compatibility shim. The per-process appSupportPath cell that used to
// live here has been removed — every caller resolves the path on demand
// from $VOICETREE_APP_SUPPORT via @vt/app-config/app-support-path.
// New callers should import resolveAppSupportPath directly; these
// re-exports keep getAppSupportPath / setAppSupportPath working until the
// last existing call site migrates.
export {resolveAppSupportPath as getAppSupportPath} from '@vt/app-config/app-support-path'

export function setAppSupportPath(path: string): void {
    process.env.VOICETREE_APP_SUPPORT = path
}

export function clearAppSupportPathForTest(): void {
    delete process.env.VOICETREE_APP_SUPPORT
}
