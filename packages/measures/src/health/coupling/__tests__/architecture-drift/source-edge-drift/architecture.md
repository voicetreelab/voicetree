# Source Edge Drift Fixture

```mermaid
flowchart TD
  graphd[Graph daemon]
  renderer[Renderer]
  graphd -->|HTTP /graph/*| renderer
  click graphd "packages/systems/graph-db-server/bin/vt-graphd.ts"
  click renderer "webapp/src/shell/UI/App.tsx"
```
