/**
 * BF-379 · Phase 3 — daemon-process active project accessor.
 *
 * vt-daemon serves exactly one project per process. The active project is set
 * once at boot by `bin/vtd.ts` (from `--project`) and read by tools that
 * need to address daemon-owned per-project state. Post-Phase-2 (BF-375) the
 * webapp no longer hosts an in-process daemon, so it does not set this
 * directly — its daemon-url-binding talks to vtd over RPC.
 *
 * Module-scope state is appropriate because the binding is process-scoped,
 * not call-scoped — every tool invocation on this process resolves to the
 * same project.
 */
let currentProject: string | null = null

export function setCurrentProject(project: string | null): void {
    currentProject = project
}

export function getCurrentProject(): string {
    if (currentProject === null) {
        throw new Error(
            'No active project: setCurrentProject must be called by the daemon host '
            + '(bin/vtd.ts at boot) before invoking tools that touch session state.',
        )
    }
    return currentProject
}

export function peekCurrentProject(): string | null {
    return currentProject
}

export function __resetCurrentProjectForTests(): void {
    currentProject = null
}
