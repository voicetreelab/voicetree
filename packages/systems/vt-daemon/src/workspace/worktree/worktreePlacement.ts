/**
 * Pure placement decisions for git worktrees.
 *
 * Two questions, both decidable without touching git: (1) is the machine-level
 * git-gate wrapper the `git` this process will run, and (2) given that, where
 * should `git worktree add` place the tree. Kept pure (the filesystem probe is
 * injected) so they are black-box testable without a real repo.
 */

import path from 'path';
import fs from 'fs';

/**
 * Decide whether the `git` binary this process will invoke is the git-gate
 * shim, by replicating Node's PATH lookup (`execFile('git', …)` runs the first
 * executable `git` on PATH) and comparing the winner to git-gate's install
 * location, `$HOME/bin/git`.
 *
 * git-gate (scripts/dev-setup/git-gate) is the machine-level wrapper that owns
 * worktree PLACEMENT: it rewrites a bare worktree name to its per-machine root.
 * When it is the resolved `git`, this app must NOT also compute a path — it
 * passes the bare name through and lets git-gate place the tree (a strict
 * no-op vs. the wrapper-owns-placement design). When it is absent, this app
 * owns placement instead.
 *
 * Resolving the binary — rather than merely testing whether `$HOME/bin/git`
 * exists — is deliberate: a stale `$HOME/bin/git` shadowed by an earlier PATH
 * entry is correctly reported inactive, because `execFile` would run that
 * earlier real git, not the shim.
 *
 * Pure: the filesystem probe is injected via `isExecutable`.
 */
export function isGitGateActive({
    pathEnv,
    homeDir,
    isExecutable,
}: {
    pathEnv: string | undefined;
    homeDir: string;
    isExecutable: (candidate: string) => boolean;
}): boolean {
    const shim: string = path.join(homeDir, 'bin', 'git');
    const dirs: string[] = (pathEnv ?? '').split(path.delimiter).filter((dir: string) => dir !== '');
    for (const dir of dirs) {
        const candidate: string = path.join(dir, 'git');
        if (isExecutable(candidate)) {
            // First match wins, exactly as execFile's PATH search does.
            return candidate === shim;
        }
    }
    return false;
}

/**
 * Decide the destination passed to `git worktree add`, and whether THIS app
 * owns placement (and must therefore normalize the worktree's git metadata
 * afterwards):
 *
 *   git-gate active → BARE name (argv unchanged): git-gate rewrites it to its
 *                     per-machine root. `appOwned` is false.
 *   git-gate absent → ABSOLUTE path under `VT_WORKTREE_ROOT`, or — absent that
 *                     shared override — the canonical sibling of the main
 *                     checkout, `<parent-of-main-checkout>/vt-wts`. Never nested
 *                     inside the watched project. `appOwned` is true.
 *
 * Pure.
 */
export function planWorktreePlacement({
    gitGateActive,
    worktreeName,
    mainCheckout,
    worktreeRootEnv,
}: {
    gitGateActive: boolean;
    worktreeName: string;
    mainCheckout: string;
    worktreeRootEnv: string | undefined;
}): { destination: string; appOwned: boolean } {
    if (gitGateActive) {
        return { destination: worktreeName, appOwned: false };
    }
    const root: string = (worktreeRootEnv !== undefined && worktreeRootEnv.trim() !== '')
        ? worktreeRootEnv
        : path.join(path.dirname(mainCheckout), 'vt-wts');
    return { destination: path.join(root, worktreeName), appOwned: true };
}

/**
 * Probe whether `candidate` is an executable regular file. Impure (fs);
 * injected into the pure `isGitGateActive`.
 */
export function isExecutableFile(candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) return false;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}
