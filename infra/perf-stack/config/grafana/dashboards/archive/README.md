# Archived Grafana Dashboards

These dashboards were vendored from Grafana's LGTM bundle, but they target JVM
and HTTP RED semantic-convention workloads. Voicetree's current perf producer
emits Node.js runtime metrics instead:

- `process_cpu_time`
- `process_memory_usage`
- `nodejs_eventloop_delay`
- `runtime_gc_count`
- `runtime_gc_pause_*`

Keeping the JVM/RED dashboards provisioned made new Grafana sessions mostly
blank for the workload this stack actually runs. They remain here with the
`.json.archived` suffix as reference material for a future JVM or HTTP-semconv
producer, but Grafana no longer loads them by default.
