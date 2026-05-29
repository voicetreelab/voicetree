## ADDED Requirements

### Requirement: App startup MUST NOT autoload recent projects

The application SHALL show the project picker on startup unless startup carries an explicit project-open request. Persisted recent-project metadata, including `lastDirectory` and `projects.json.lastOpened`, SHALL NOT cause a project to open automatically.

#### Scenario: Persisted lastDirectory exists

- **GIVEN** global config contains `lastDirectory = "/projects/recent"`
- **WHEN** the renderer asks for the startup project hint
- **THEN** the hint is `{ kind: "none" }`
- **AND** no call to open a project is made from that value

#### Scenario: Recent projects exist

- **GIVEN** `projects.json` contains one or more saved projects with `lastOpened` timestamps
- **WHEN** the app starts normally
- **THEN** the project picker displays the saved projects sorted by recency
- **AND** no saved project is opened until the user selects one

### Requirement: Explicit startup project opens remain supported

An explicit startup folder override SHALL remain a valid startup open request.

#### Scenario: Open folder override exists

- **GIVEN** the process was launched with an explicit open-folder path
- **WHEN** the renderer asks for the startup project hint
- **THEN** the hint is `{ kind: "open-folder", projectPath: <path> }`
- **AND** the app opens that project without requiring a picker click

### Requirement: Project picker opens projects through one public transition

Project selection, browsing for an existing folder, and creating a new project SHALL converge on one public project-open transition that accepts a project root path.

#### Scenario: User selects saved project

- **WHEN** the user selects a saved project from the picker
- **THEN** the renderer calls `openProject(projectPath)` once
- **AND** project setup and write-folder resolution occur behind that transition
- **AND** the response contains the authoritative `projectPath` and `writeFolderPath`

#### Scenario: User creates new project

- **WHEN** the user creates a new project from the picker
- **THEN** the project directory is created under the default projects home
- **AND** the renderer calls `openProject(projectPath)` once
- **AND** the new project does not become an implicit startup target for future launches

### Requirement: Project root and write folder MUST remain distinct

The lifecycle API SHALL distinguish the project root path from the selected write folder path.

#### Scenario: Project root has dated write folder

- **GIVEN** `projectPath = "/repo/project"`
- **AND** `writeFolderPath = "/repo/project/voicetree-29-5"`
- **WHEN** daemon auth, port, owner, terminal, or discovery files are resolved
- **THEN** those files resolve under `/repo/project/.voicetree`
- **AND** they do not resolve under `/repo/project/voicetree-29-5/.voicetree`

#### Scenario: New authored node is created

- **GIVEN** an open project with a selected `writeFolderPath`
- **WHEN** a new authored Markdown node is created
- **THEN** the node is written under `writeFolderPath`
- **AND** project-local runtime state remains under `projectPath/.voicetree`

### Requirement: Startup hint type MUST represent only explicit startup intent

The startup hint type SHALL have no `last-directory` or equivalent recent-project variant.

#### Scenario: Type drift check

- **WHEN** the startup hint type is inspected
- **THEN** its variants are exactly `open-folder` and `none`
- **AND** adding a recent-project startup variant fails the drift check
