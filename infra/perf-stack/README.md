# Native perf stack

This directory contains the local-only LGTM-lite perf stack used by Voicetree
performance runs.

```sh
npm run perf:install
npm run perf:up
npm run perf:check
npm run perf:view -- <run-uuid>
npm run perf:down
```

All services bind to `127.0.0.1`. Backend storage lives under
`infra/perf-stack/storage/` and is wiped by `npm run perf:down` unless
`-- --persist` is passed. Plain run artifacts under `~/.voicetree/perf/<uuid>/`
are never touched by lifecycle commands.

## Phase 2 edit protocol

`config/otelcol.yaml` has named placeholder sections. Parallel Phase 2 agents
must edit only their owned placeholder sections:

- `PHASE_2A_LOGS_*`
- `PHASE_2B_METRICS_*`
- `PHASE_2C_TRACES_*`

Profiles do not use otelcol in v1; Pyroscope receives profile data directly.
