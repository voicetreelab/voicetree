#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-origin}"
SOURCE_BRANCH="${SOURCE_BRANCH:-dev}"
TARGET_BRANCH="${TARGET_BRANCH:-dev-manu}"

git fetch "$REMOTE" "$SOURCE_BRANCH" "$TARGET_BRANCH"
git checkout "$TARGET_BRANCH"

if git merge-base --is-ancestor "$REMOTE/$SOURCE_BRANCH" HEAD; then
    echo "$TARGET_BRANCH already contains $REMOTE/$SOURCE_BRANCH"
    exit 0
fi

git merge --no-edit "$REMOTE/$SOURCE_BRANCH"
git push "$REMOTE" "$TARGET_BRANCH"
