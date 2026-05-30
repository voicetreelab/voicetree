# Native perf stack

This directory contains the local-only LGTM-lite perf stack used by Voicetree
performance runs.

```sh
npm run perf:install
npm run perf:up
npm run perf:check
npm run perf:view -- <run-uuid>
npm run perf:profile-for-trace -- --trace-id=<trace-id>
npm run perf:down
```

All services bind to `127.0.0.1`. Backend storage lives under
`infra/perf-stack/storage/` and is wiped by `npm run perf:down` unless
`-- --persist` is passed. Plain run artifacts under `~/.voicetree/perf/<uuid>/`
are never touched by lifecycle commands.

## Auto-attach on `npm run electron(:prod)`

Running the app locally attaches the stack automatically — no manual
`perf:install` / `perf:up` first. The webapp `electron` and `electron:prod`
scripts wrap their launch in `scripts/ensure-perf-stack.mjs`, an idempotent
preflight that:

1. installs the native binaries on first run (one-time download into `bin/`),
2. brings the stack up if it isn't already (a warm stack is a fast no-op), and
3. exports `VOICETREE_OTLP_ENDPOINT=http://localhost:2994` (otelcol gRPC) plus a
   fresh `VOICETREE_RUN_INSTANCE_ID` into the launched process.

Both `vt-electron-main` and the `vt-graphd` daemon it spawns then export OTLP to
the collector; the launch prints `Grafana: http://localhost:2999` so the
dashboards are one click away.

### Opt-out — `PERF_STACK=0`

```sh
PERF_STACK=0 npm run electron
```

Skips the preflight entirely: no install, no `up`, and `VOICETREE_OTLP_ENDPOINT`
is left unset so the OTLP exporter never attaches. Only the always-on NDJSON
exporter under `~/.voicetree/traces/` runs — i.e. exactly the pre-auto-attach
behavior. Use this when you don't want the six resident perf-stack services on
your machine for a given launch.

## Trace to profile correlation

`npm run perf:profile-for-trace -- --trace-id=<trace-id>` loads a Tempo trace,
selects the longest span by default, maps its OTel resource attributes to
Pyroscope labels, and verifies that Pyroscope has samples in the span time
window. Use `--span-id=<span-id>` or `--span-name=<span-name>` to inspect a
specific span.

## Phase 2 edit protocol

`config/otelcol.yaml` has named placeholder sections. Parallel Phase 2 agents
must edit only their owned placeholder sections:

- `PHASE_2A_LOGS_*`
- `PHASE_2B_METRICS_*`
- `PHASE_2C_TRACES_*`

Profiles do not use otelcol in v1; Pyroscope receives profile data directly.
