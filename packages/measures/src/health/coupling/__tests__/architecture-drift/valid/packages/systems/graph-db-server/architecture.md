---
refines: graphd
---
# Graph Daemon Fixture

```mermaid
flowchart TD
  daemon[Daemon entry]
  routes[Routes]
  daemon -->|mounts| routes
  click daemon "packages/systems/graph-db-server/src/daemon.ts"
  click routes "packages/systems/graph-db-server/src/routes"
```
