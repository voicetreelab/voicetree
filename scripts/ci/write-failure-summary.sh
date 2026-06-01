#!/usr/bin/env bash
set -euo pipefail

summary_path="${GITHUB_STEP_SUMMARY:-}"
if [ -z "$summary_path" ]; then
  exit 0
fi

title="${1:-CI job failed}"

{
  printf '## %s\n\n' "$title"
  printf -- '- Workflow: `%s`\n' "${GITHUB_WORKFLOW:-unknown}"
  printf -- '- Job: `%s`\n' "${GITHUB_JOB:-unknown}"
  printf -- '- Run: `%s`\n' "${GITHUB_RUN_ID:-unknown}"
  printf '\n'

  if command -v gh >/dev/null 2>&1 && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
    printf 'To inspect failed logs locally:\n\n'
    printf '```sh\n'
    printf 'gh run view %s --repo %s --log-failed\n' "$GITHUB_RUN_ID" "$GITHUB_REPOSITORY"
    printf '```\n\n'
  fi

  if [ -d health-dashboard/reports/checks ]; then
    printf '### Failed Check Reports\n\n'
    if command -v jq >/dev/null 2>&1; then
      find health-dashboard/reports/checks -name '*.json' -type f -print \
        | sort \
        | while IFS= read -r report; do
            status="$(jq -r '.status // empty' "$report" 2>/dev/null || true)"
            [ "$status" = "fail" ] || continue
            check_id="$(jq -r '.checkId // .id // empty' "$report" 2>/dev/null || true)"
            error_summary="$(jq -r '.errorSummary // empty' "$report" 2>/dev/null || true)"
            printf -- '- `%s` (`%s`)\n' "${check_id:-unknown}" "$report"
            if [ -n "$error_summary" ]; then
              printf '\n```text\n%s\n```\n\n' "$error_summary"
            fi
          done
    else
      find health-dashboard/reports/checks -name '*.json' -type f -print | sort | sed 's/^/- `/' | sed 's/$/`/'
      printf '\n'
    fi
  fi

  for artifact_dir in webapp/test-results webapp/playwright-report webapp/playwright-report-tier1-system; do
    if [ -d "$artifact_dir" ]; then
      printf '\n### Artifact Directory\n\n'
      printf -- '- `%s`\n' "$artifact_dir"
    fi
  done
} >> "$summary_path"
