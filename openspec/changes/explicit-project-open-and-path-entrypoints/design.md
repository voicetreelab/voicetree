# Design: Explicit Project Open and Path Entrypoints

## Core Model

Use four distinct roles:

```text
voicetreeHomePath
  global user state and settings

defaultProjectsHomePath
  default parent directory for "New project"

projectPath
  selected project root; owns project-local .voicetree/

writeFolderPath
  selected target folder for new authored Markdown files
```

This change does not need to finish the repo-wide rename. It does need app-open and project-picker code to stop treating one role as another.

## App Startup

Startup is picker-first.

```text
Electron main starts
  |
  v
Renderer mounts App
  |
  v
ProjectSelectionScreen renders
  |
  v
getStartupProjectHint()
  |
  +-- explicit open-folder -> openProject(projectPath)
  |
  +-- none                 -> stay on picker
```

The startup hint MUST NOT consult `lastDirectory` or sorted recent projects. Recent projects are UI list data only.

## Project Picker

Picker selection is the normal user-driven project-open path.

```text
ProjectSelectionScreen
  |
  +-- load saved projects
  +-- scan discovered projects
  |
  v
user selects / creates / browses project
  |
  v
openProject(projectPath)
```

The picker may update `projects.json` metadata such as `lastOpened`, but that metadata must not change app startup behavior.

## Single Project-Open Transition

Target shape:

```ts
type OpenProjectRequest = {
  readonly projectPath: string
}

type OpenProjectResponse = {
  readonly sessionId: string
  readonly projectPath: string
  readonly writeFolderPath: string
  readonly initialProjectedGraph: unknown
  readonly folderState: readonly unknown[]
  readonly activeView: unknown
}
```

Current code may continue to call the underlying daemon route `openVault` during migration, but the public app lifecycle should be conceptually `openProject(projectPath)`.

## Ownership Boundary

Renderer responsibilities:

- render project picker;
- collect user intent;
- call one project-open API with a project path;
- render the returned initial graph.

Electron main responsibilities:

- native dialogs;
- IPC bridge;
- process/daemon binding;
- push renderer lifecycle events.

Daemon/VTD responsibilities:

- create project-local `.voicetree/` if missing;
- resolve or create the `writeFolderPath`;
- open/switch the project under a lifecycle mutex;
- return initial graph and folder/view state in one response.

## Duplicate Initialization To Remove

Current duplicated shape:

```text
App.handleProjectSelected
  -> initializeProject(project.path)
  -> saveProject(initialized)
  -> openVault(project.path)
       -> resolveOrCreateWriteFolder(projectRoot)
            -> initializeProject(projectRoot) again if needed
       -> daemon openVaultWorkflow()
            -> resolveDefaultWriteFolder(projectRoot) if needed
```

Target shape:

```text
App.handleProjectSelected
  -> openProject(projectPath)
       -> daemon/VTD owns project setup and writeFolderPath resolution
       -> response includes authoritative writeFolderPath
  -> save project metadata if needed
```

## Explicit Open-Folder Override

`--open-folder <path>` remains valid. It represents explicit user/system intent to open a project at startup. The startup hint type should make this distinction visible:

```ts
type StartupProjectHint =
  | { readonly kind: 'open-folder'; readonly projectPath: string }
  | { readonly kind: 'none' }
```

There is intentionally no `last-directory` variant.

## Migration Strategy

1. Add regression tests for startup hints: persisted `lastDirectory` must not auto-open, explicit `--open-folder` must.
2. Rename the app-facing lifecycle wrapper from `openVaultForProject` toward `openProject`.
3. Remove renderer-side `initializeProject()` from selection flow once daemon setup is authoritative.
4. Keep recent-project list sorting in the picker.
5. Add drift tests that prevent reintroducing `lastDirectory` as a startup hint.

## Risks

- Existing e2e tests may depend on autoloading the last project. Those tests should be updated to either click the picker or pass an explicit `--open-folder`.
- Moving initialization behind daemon open may expose differences between Electron onboarding templates and daemon default write-folder behavior. Resolve by making daemon setup the single source, not by preserving dual setup.
- Broad `vault` vocabulary remains until the sibling OpenSpec lands. This change should avoid expanding the old vocabulary surface.
