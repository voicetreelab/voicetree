#!/usr/bin/env bash
set -euo pipefail

version="${1:-latest}"
event_name="${2:-${GITHUB_EVENT_NAME:-}}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
asset_name="voicetree.AppImage"

write_output() {
    local key="$1"
    local value="$2"
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
    fi
    printf '%s=%s\n' "$key" "$value"
}

find_latest_with_appimage() {
    local rows
    if ! rows="$(gh api "repos/${repo}/releases" --paginate --jq '
        .[]
        | select(.draft | not)
        | select(.prerelease | not)
        | select(any(.assets[]?; .name == "voicetree.AppImage"))
        | [
            .tag_name,
            (.assets[] | select(.name == "voicetree.AppImage") | .browser_download_url)
          ]
        | @tsv
    ')"; then
        echo "Failed to query GitHub releases for ${repo}." >&2
        return 1
    fi
    printf '%s\n' "$rows" | sed -n '1p'
}

find_tag_appimage_url() {
    local tag="$1"
    local rows
    if ! rows="$(gh api "repos/${repo}/releases/tags/${tag}" --jq '
        .assets[]?
        | select(.name == "voicetree.AppImage")
        | .browser_download_url
    ')"; then
        echo "Failed to query GitHub release ${tag} for ${repo}." >&2
        return 1
    fi
    printf '%s\n' "$rows" | sed -n '1p'
}

if [[ "$version" == "latest" ]]; then
    resolved="$(find_latest_with_appimage)"
    if [[ -z "$resolved" ]]; then
        echo "No non-prerelease GitHub release contains ${asset_name}." >&2
        exit 1
    fi

    tag="${resolved%%$'\t'*}"
    url="${resolved#*$'\t'}"
    write_output should_build true
    write_output tag "$tag"
    write_output appimage_url "$url"
    write_output skip_reason ""
    exit 0
fi

url="$(find_tag_appimage_url "$version")"
if [[ -n "$url" ]]; then
    write_output should_build true
    write_output tag "$version"
    write_output appimage_url "$url"
    write_output skip_reason ""
    exit 0
fi

reason="Release ${version} has no ${asset_name} asset."
if [[ "$event_name" == "release" ]]; then
    write_output should_build false
    write_output tag "$version"
    write_output appimage_url ""
    write_output skip_reason "$reason"
    exit 0
fi

echo "$reason" >&2
exit 1
