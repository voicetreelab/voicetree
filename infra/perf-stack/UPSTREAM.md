# perf-stack upstream pins

Last sync: 2026-05-26

Upstream source: `grafana/docker-otel-lgtm`
Upstream commit: `8ebeccf63198fa8168c8071b067caec8651c6e99`

The task's historical raw paths under `docker/otel-lgtm/` now return 404. The
current upstream layout at this commit keeps the files at `docker/*` plus the
top-level `run-lgtm.sh`.

## Component versions

| Component | Version | Source |
|---|---:|---|
| Grafana | `v13.0.1` | `docker/Dockerfile` `GRAFANA_VERSION` |
| Loki | `v3.7.2` | `docker/Dockerfile` `LOKI_VERSION` |
| Tempo | `v2.10.5` | `docker/Dockerfile` `TEMPO_VERSION` |
| Prometheus in upstream LGTM | `v3.11.3` | `docker/Dockerfile` `PROMETHEUS_VERSION` |
| VictoriaMetrics replacement | `v1.144.0` | latest stable release on 2026-05-26; Prometheus remote-write/query compatible |
| Pyroscope | `v2.0.2` | `docker/Dockerfile` `PYROSCOPE_VERSION` |
| otelcol-contrib | `v0.152.0` | `docker/Dockerfile` `OPENTELEMETRY_COLLECTOR_VERSION` |

## Vendored files

None yet in Phase 0+1. Skeleton configs are VT-owned. Phase 2 and Phase 3 agents
will vendor or adapt the upstream pipeline and Grafana provisioning files.

## Upstream files inspected

- `docker/Dockerfile`
- `run-lgtm.sh`
- `docker/download-grafana.sh`
- `docker/download-loki.sh`
- `docker/download-tempo.sh`
- `docker/download-pyroscope.sh`
- `docker/download-otelcol.sh`
- `docker/run-grafana.sh`
- `docker/run-loki.sh`
- `docker/run-tempo.sh`
- `docker/run-pyroscope.sh`
- `docker/run-otelcol.sh`
- `docker/loki-config.yaml`
- `docker/tempo-config.yaml`
- `docker/pyroscope-config.yaml`
- `docker/otelcol-config.yaml`
- `docker/grafana-datasources.yaml`
- `docker/grafana-dashboards.yaml`

## Known deviations

- Tempo publishes Linux and Windows release archives, but no Darwin archive for
  `v2.10.5`. On `darwin-arm64`, `install-binaries.mjs` downloads the pinned tag
  commit source archive (`991ce39eb956e9ed771fcffe05eff42d33de27ba`), verifies
  SHA-256 `d8d1c1c7949343263621fa5d6b98030486841d1fb64622bbbbcb7ac21b593540`,
  and builds `./cmd/tempo` with Go. This is not a binary download; it is a
  checksum-pinned source build plus Go module checksum verification. If upstream
  starts publishing Darwin archives, replace this with a normal archive manifest
  entry.
- The stack uses VictoriaMetrics instead of upstream Prometheus/Mimir. This is
  an intentional OpenSpec decision for a smaller single-node dev stack.
