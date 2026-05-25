# Valid Architecture Fixture

```mermaid
flowchart TD
  graphd[Graph daemon]
  renderer[Renderer]
  graphd -->|HTTP /graph/*| renderer
  click graphd "packages/systems/graph-db-server"
  click renderer "webapp/src/shell/UI/App.tsx"
```
