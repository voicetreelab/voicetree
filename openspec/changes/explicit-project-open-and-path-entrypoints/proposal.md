# Change: Explicit Project Open and Path Entrypoints

## Why

VoiceTree has two related problems in the initial app-open path:

- Startup can implicitly open the most recently opened project from persisted `lastDirectory`.
- Project loading responsibilities are split across renderer, Electron main, graph daemon, VTD, and app-config helpers.

The first problem is user-visible: opening the app should show the project picker unless the user explicitly asked to open a project. A persisted recent project is useful picker data, not an instruction to load it.

The second problem is architectural: several concepts are still easy to confuse:

- global VoiceTree home / app support path;
- default location for newly created projects;
- project root path, where project-local `.voicetree/` lives;
- write folder path, where new authored Markdown nodes are written.

When these are mixed, code can look up daemon files under a write subfolder, initialize project scaffolding twice, or make startup behavior depend on a stale persisted path.

## What Changes

- Make app startup picker-first by default.
- Keep recent projects in the project picker, but never auto-open them on launch.
- Preserve explicit open behavior for `--open-folder <path>` and menu actions that intentionally launch a project.
- Collapse project loading to one explicit public transition:

```text
openProject(projectPath)
```

- Move project initialization, `.voicetree/` setup, and write-folder resolution behind that transition.
- Treat `projectPath` and `writeFolderPath` as separate names in new code.
- Keep this change scoped to app-open and project-loading entrypoints. The broader vocabulary migration stays in `unify-voicetree-home-and-project-paths`.

## Non-Goals

- Rename every `vault` symbol in the repository.
- Replace the global home path API while another agent is implementing it.
- Remove the project picker recent-project list.
- Change existing project data formats beyond what is needed to stop startup autoload.

## Relationship To Existing Specs

This change complements, but does not replace, `runtime-state/unify-voicetree-home-and-project-paths`.

That change owns the broad vocabulary and home-path migration. This change owns the narrower lifecycle rule:

```text
recent project metadata is not an app-start command
```

It also defines the desired call shape for the project picker and initial app-open flow so the path vocabulary work has a clean lifecycle boundary to target.

## Impact

Likely touched code:

- `webapp/src/shell/UI/App.tsx`
- `webapp/src/shell/UI/ProjectSelectionScreen.tsx`
- `webapp/src/shell/UI/views/graph-view/VoiceTreeGraphView.ts`
- `webapp/src/shell/edge/main/graph/watch_folder/openVault.ts`
- `webapp/src/shell/edge/main/runtime/electron/startup/startup-folder-override.ts`
- `webapp/src/shell/edge/main/workspace/project-*`
- `packages/systems/graph-db-server/src/application/workflows/vaultLifecycle.ts`
- tests around startup hints, project picker selection, and daemon open workflow
