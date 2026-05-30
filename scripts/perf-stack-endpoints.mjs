// Single source of truth for the local perf-stack network endpoints.
//
// otelcol listens for OTLP gRPC on :2994 (see infra/perf-stack/config/otelcol.yaml)
// and Grafana serves on :2999. Both the interactive auto-attach path
// (ensure-perf-stack.mjs) and the storm-profile path (run-electron-profile.mjs)
// import from here so the two cannot drift to different ports.

export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:2994'

export const GRAFANA_BASE_URL = 'http://localhost:2999'

export const GRAFANA_RUNS_DASHBOARD = `${GRAFANA_BASE_URL}/d/vt-runs/vt-runs`
