#!/usr/bin/env bash
# Idempotently set KEY=VALUE in an env file.

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <env-file> <key> <value>" >&2
  exit 64
fi

ENV_FILE="$1"
KEY="$2"
VALUE="$3"

case "$KEY" in
  [A-Za-z_][A-Za-z0-9_]*) ;;
  *) echo "write-env-value: invalid key: $KEY" >&2; exit 64 ;;
esac

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

TMP="$(mktemp)"
awk -v key="$KEY" -v line="$KEY=$VALUE" '
  BEGIN { written = 0 }
  $0 ~ "^" key "=" {
    if (!written) {
      print line
      written = 1
    }
    next
  }
  { print }
  END {
    if (!written) print line
  }
' "$ENV_FILE" > "$TMP"
mv "$TMP" "$ENV_FILE"
