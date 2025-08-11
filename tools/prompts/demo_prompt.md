Task: Orchestrate the work for @$OBSIDIAN_SOURCE_NOTE
Managing your agents. 

1. First gather all relevant context, 
2. think very hard about the task, and the proposed implementation plan. Is it good? Any problems with it? 
3. Decompose this parent task into subtasks.

Use @$USER_ROOT_DIR/repos/VoiceTree/CREATE_SUBAGENTS_COMMAND.md as a guide for creating the subtask files, and then afterwards, for creating the .sh files which will launch the subagents.

After creating each subtask file, make sure you also generate the .sh command with the python tool outlined in the CREATE_SUBAGENTS_COMMAND.md file.

Start with creating a blue bob agent, an example subtask md file is at @AGENT_BOB.md, you can reuse this format.
But make sure to create the file in our directory, and with a concise name for the task, starting with AGENT_BOB_...

After you have made each subtask file, return to the user a list of the commands needed to execute to run each agent.

When creating additional files connected to @$OBSIDIAN_SUBTASK_SOURCE_NOTE extending the markdown tree, ensure the new files are connected by markdown links 
e.g. `[[$OBSIDIAN_SOURCE_NOTE]]`,

For each of these new files, ensure the yaml front matter has `color: <color>`. e.g. color could be blue, green, yellow, red for each agent.


