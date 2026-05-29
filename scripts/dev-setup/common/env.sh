#!/bin/sh
# Shared dev-setup environment helpers.

dev_setup_home_env() {
  printf '%s/.env\n' "$HOME"
}

dev_setup_read_env_value() {
  key="$1"
  file="$2"
  [ -f "$file" ] || return 1

  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      if (($0 ~ /^".*"$/) || ($0 ~ /^'\''.*'\''$/)) {
        $0 = substr($0, 2, length($0) - 2)
      }
      print
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$file"
}

dev_setup_main_checkout_root() {
  worktree_path="$1"
  git -C "$worktree_path" worktree list --porcelain | awk '/^worktree /{print $2; exit}'
}

dev_setup_resolve_dev_role() {
  if [ -n "${VT_DEV_ROLE:-}" ]; then
    printf '%s\n' "$VT_DEV_ROLE"
    return 0
  fi

  home_env="$(dev_setup_home_env)"
  role="$(dev_setup_read_env_value VT_DEV_ROLE "$home_env" 2>/dev/null || true)"
  if [ -n "$role" ]; then
    printf '%s\n' "$role"
    return 0
  fi

  case "$(uname -s)" in
    Darwin) printf 'mac\n' ;;
    Linux) printf 'remote\n' ;;
    *)
      printf 'unknown\n'
      return 1
      ;;
  esac
}

dev_setup_resolve_remote_host() {
  worktree_path="$1"
  main_checkout="${2:-}"

  if [ -n "${VT_REMOTE_HOST:-}" ]; then
    printf '%s\n' "$VT_REMOTE_HOST"
    return 0
  fi

  home_env="$(dev_setup_home_env)"
  host="$(dev_setup_read_env_value VT_REMOTE_HOST "$home_env" 2>/dev/null || true)"
  if [ -n "$host" ]; then
    printf '%s\n' "$host"
    return 0
  fi

  host="$(dev_setup_read_env_value VT_REMOTE_HOST "$worktree_path/.env" 2>/dev/null || true)"
  if [ -n "$host" ]; then
    printf '%s\n' "$host"
    return 0
  fi

  if [ -n "$main_checkout" ]; then
    host="$(dev_setup_read_env_value VT_REMOTE_HOST "$main_checkout/.env" 2>/dev/null || true)"
    if [ -n "$host" ]; then
      printf '%s\n' "$host"
      return 0
    fi
  fi

  return 1
}

dev_setup_link_worktree_env() {
  worktree_path="$1"
  main_checkout="$2"

  if [ -n "$main_checkout" ] && [ -f "$main_checkout/.env" ] && [ ! -e "$worktree_path/.env" ]; then
    ln -snf "$main_checkout/.env" "$worktree_path/.env"
  fi
}
