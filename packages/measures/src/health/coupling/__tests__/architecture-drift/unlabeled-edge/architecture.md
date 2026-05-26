# Unlabeled Edge Fixture

```mermaid
flowchart TD
  graphd[Graph daemon]
  renderer[Renderer]
  renderer --> graphd
  click graphd "packages/systems/graph-db-server"
  click renderer "webapp/src/shell/UI/App.tsx"
```
