#!/bin/sh
# vt-mirror-worktree.sh
# Register a worktree on the devbox side so it mirrors the local one.
#
# Mutagen syncs the working-tree CONTENTS (it ignores .git/), so this script
# only needs to set up the devbox-side admin metadata: create
# .git/worktrees/<name>/ on devbox and ensure .worktrees/<name>/.git
# resolves to it. Pointer files are written as relative paths so they read
# the same on both sides.
#
# Idempotent: if devbox already has the admin dir, the script is a no-op.
#
# Usage: vt-mirror-worktree.sh <worktreePath> <worktreeName>
#   (called by on-worktree-created-async.sh; can also be invoked directly)

set -e

WORKTREE_PATH="$1"
WORKTREE_NAME="$2"

if [ -z "$WORKTREE_PATH" ] || [ -z "$WORKTREE_NAME" ]; then
    echo "Usage: $0 <worktreePath> <worktreeName>" >&2
    exit 1
fi

DEVBOX_HOST="root@216.176.239.155"
DEVBOX_REPO="/root/voicetree-public"

# Establish what HEAD content to write. For a branch worktree, HEAD holds
# "ref: refs/heads/<branch>". For detached HEAD, it holds the SHA.
LOCAL_ADMIN="$(git -C "$WORKTREE_PATH" rev-parse --git-dir)"
LOCAL_HEAD="$(cat "$LOCAL_ADMIN/HEAD")"
LOCAL_SHA="$(git -C "$WORKTREE_PATH" rev-parse HEAD)"

# Make local-side pointers relative too, so they stay portable.
echo "gitdir: ../../.git/worktrees/$WORKTREE_NAME" > "$WORKTREE_PATH/.git"
echo "../../../.worktrees/$WORKTREE_NAME/.git" > "$LOCAL_ADMIN/gitdir"

# Push the worktree's commit objects to devbox under a side-ref so devbox's
# git can resolve HEAD. A side-ref (refs/vt-mirror/<name>) avoids clashing
# with branches; the push is a pure object-transfer to the local-controlled
# mirror, NOT a code-review submission to a shared upstream — so the
# pre-push verification hook is intentionally skipped via --no-verify.
git push --no-verify --quiet \
    "${DEVBOX_HOST}:${DEVBOX_REPO}" \
    "${LOCAL_SHA}:refs/vt-mirror/${WORKTREE_NAME}" 2>&1 || {
    echo "vt-mirror-worktree: push of objects to devbox failed; devbox may not have HEAD commit" >&2
}

# Bootstrap devbox-side admin dir. Doesn't depend on mutagen having delivered
# the worktree dir yet — mkdir's a placeholder so `git reset` has something to
# attach to, and writes the .git pointer file. Mutagen overwrites the pointer
# later with the identical relative content, so no conflict arises.
ssh -o ConnectTimeout=10 -o BatchMode=yes "$DEVBOX_HOST" "
    set -e
    ADMIN_DIR='$DEVBOX_REPO/.git/worktrees/$WORKTREE_NAME'
    WT_DIR='$DEVBOX_REPO/.worktrees/$WORKTREE_NAME'
    if [ -d \"\$ADMIN_DIR\" ]; then
        echo 'vt-mirror-worktree: devbox already has admin dir for $WORKTREE_NAME, no-op'
        exit 0
    fi
    mkdir -p \"\$WT_DIR\" \"\$ADMIN_DIR\"
    echo '../..' > \"\$ADMIN_DIR/commondir\"
    echo '../../../.worktrees/$WORKTREE_NAME/.git' > \"\$ADMIN_DIR/gitdir\"
    printf '%s\\n' '$LOCAL_HEAD' > \"\$ADMIN_DIR/HEAD\"
    echo 'gitdir: ../../.git/worktrees/$WORKTREE_NAME' > \"\$WT_DIR/.git\"
    git -C \"\$WT_DIR\" reset --quiet HEAD
    echo \"vt-mirror-worktree: registered $WORKTREE_NAME on devbox at \$(git -C \"\$WT_DIR\" rev-parse HEAD)\"
" 2>&1
