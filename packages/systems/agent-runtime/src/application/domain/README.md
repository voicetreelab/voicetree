# Agent Runtime Application Domain

## Layers

`agent-runtime` mirrors the FCIS shape used by
`packages/systems/graph-db-server/src/application/`:

- `domain/` contains type-only contracts shared by the application layer.
- `core/` contains pure handlers that decide next state, commands, and response.
- `effects/` interprets command data against mutable registries or IO.
- `workflows/` loads current state, calls core handlers, applies commands, and
  returns the transport-facing response.

## Command Protocol

Core handlers return `Command[]` rather than calling registries, terminal
managers, hooks, or UI broadcasters directly.

`effects/runCommand.ts` owns the exhaustive `switch` over command variants. Add
one command variant per new side effect needed by a migrated handler, and let the
`never` check catch commands whose interpreter branch is missing.

## How to Migrate a Handler

1. Pick one handler with a small state boundary and existing black-box tests.
2. Move only its pure decision logic into `application/core/handle<Name>.ts`.
3. Add the command variants the handler needs in `domain/command.ts`.
4. Interpret those variants in `effects/runCommand.ts`.
5. Add `application/workflows/<name>.ts` to fetch state, call the core handler,
   run commands, and return the same observable response as before.
6. Leave the original transport file as a thin wrapper importing the workflow.

## Worked Example

The first agent-runtime pilot is plain terminal spawning:

- `core/handlePlainTerminal.ts` decides terminal launch parameters.
- `effects/runCommand.ts` creates terminal data, updates graph state, and launches UI.
- `workflows/plainTerminal.ts` reads settings, graph, registry, and env state.
- `spawn/spawnPlainTerminal.ts` is the transport-facing wrapper.

For the canonical package-level shape, compare
`packages/systems/graph-db-server/src/application/domain/command.ts`,
`core/handleCollapse.ts`, `effects/runCommand.ts`, and
`workflows/collapse.ts`.
