---
position:
  x: 1298.6920752258595
  y: -1870.2399553681837
isContextNode: false
---
# Hotkeys & other features

### Navigation
- Hold **space** to follow most recent node
- **Cmd + ] or [[** to cycle between terminals
- **Cmd + 1-5** to navigate to recently added or modified nodes (appear as tabs in the top left)
- **Cmd + E** to open the graph search / command pallete (nodes here are ordererd by recently selected)

## Markdown nodes

- **Cmd + drag** to select nodes. Hover also selects node.
- **Cmd + n** to create new child node, or if no node is selected, creates orphan node
- **Cmd + backspace** to delete selected node(s)
- **Cmd + enter** to run this node the default agent (first agent in the agents array in settings.json)
- **Cmd + z** / **cmd + shift + z** to undo / redo 

### File Syncing
Markdown files are only read and written to the vault folder you have specified in the bottom left corner.

i.e. {project_dir}/{vault_folder}

agents will spawn by default in {project_dir}, but you can change this in the settings, for example to "../../" so that agents spawn two directories above your project. 

### Settings
All settings are currently contained in the settings.json file (`~/Library/Application\ Support/VoiceTree/settings.json`) 

You can open the editor for this file in the floating menu on the right hand side of the graph.

### Agents
All prompts and commands for running agents can be modified in the settings. 

Tell Agents at any Time to 'add a progress node'

These will show up in the top right under the respective terminal/agent tab

You can get creative with this, for example, expirement with asking an agent to use the add node tool to create a task tree for their proposed plan.




[voicetree/other_features_0.md]]