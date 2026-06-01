# Tasks: explicit-project-open-and-path-entrypoints

## Phase 1: Startup Autoload Regression

- [x] 1.1 Remove `lastDirectory` from startup hint resolution.
- [x] 1.2 Update renderer startup bootstrap to only open explicit `open-folder` hints.
- [x] 1.3 Align graph-view startup hint type with the actual hint variants.
- [x] 1.4 Add a black-box startup hint test proving persisted `lastDirectory` returns `{ kind: 'none' }`.
- [x] 1.5 Add a black-box startup hint test proving explicit startup folder override still returns `open-folder`.

Implemented in commit `41fac1330 Stop autoloading last opened project`.

## Phase 2: App-Facing Lifecycle Vocabulary

- [ ] 2.1 Introduce an app-facing `openProject(projectPath)` wrapper over the current daemon open route.
- [ ] 2.2 Rename renderer-local `openProjectForProject` to `openProject`.
- [ ] 2.3 Rename startup hint type to `StartupProjectHint`.
- [ ] 2.4 Use `projectPath` in app-facing request/response names.
- [ ] 2.5 Keep lower-level daemon/client `openProject` names untouched unless the sibling vocabulary migration owns that package.

## Phase 3: Remove Duplicate Project Initialization

- [ ] 3.1 Add a regression test around project-picker selection that asserts one public project-open transition.
- [ ] 3.2 Move any onboarding/template copy needed by project open behind daemon/VTD setup.
- [ ] 3.3 Remove renderer-side `initializeProject(project.path)` from `App.handleProjectSelected`.
- [ ] 3.4 Make project metadata update (`lastOpened`, `voicetreeInitialized` or successor fields) happen after a successful project-open response.
- [ ] 3.5 Delete `voicetreeInitialized` if it becomes redundant after daemon-owned setup.

## Phase 4: Explicit Path Roles

- [ ] 4.1 Document `defaultProjectsHomePath` as the only meaning of `~/Voicetree`.
- [ ] 4.2 Ensure "New project" uses `defaultProjectsHomePath`, not app support or project runtime paths.
- [ ] 4.3 Ensure daemon auth/port/discovery files resolve from `projectPath/.voicetree`, not `writeFolderPath/.voicetree`.
- [ ] 4.4 Add tests for project root with dated write subfolder to prevent root/write-folder confusion.

## Phase 5: E2E And Drift Coverage

- [ ] 5.1 Update e2e launch helpers that preseed `lastDirectory` to pass explicit `--open-folder` or click the picker.
- [ ] 5.2 Add a drift check that rejects a `last-directory` startup hint variant.
- [ ] 5.3 Add a drift check or focused test proving `getStartupProjectHint` does not import/read global config.
- [ ] 5.4 Run webapp typecheck and focused startup/project-picker tests.
