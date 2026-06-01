// Trip-test fixture for the name-uniqueness tier-0 measure. Declares
// `project` as a top-level export — collides with the `project` declared in
// existing files across the repo (see tasks.md Phase 4.3). Safe to
// delete after the trip-test passes; the underscore-prefix name keeps
// it out of the boundary-width / runner discovery scans.

export function project(): void {
    // intentionally empty
}
