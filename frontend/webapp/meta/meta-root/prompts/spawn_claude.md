### FOR SIMPLE TASKS (single file, no algos)

`claude -p --dangerously-skip-permissions "Say hello. Specify which files you changed in your output." --model sonnet`# for simple tasks

### FOR COMPLEX TASKS
```
claude -p --dangerously-skip-permissions "YOUR LONG PROMMPT (DONT PUT SPECIAL CHARS HERE" --model opus` >> tmp/output<agent_name>.md
```
(give them atleast a 10 minute bash timeout)

We want to build everything as isolatable modules. e.g. for a hover editor, first have a playwright test that tests its full functionality of the hover editor in isolation. 
Then a separate test, (re-use ones that already exist for each level) of the hover editor within the cytoscape+react+electron(maybe) environment.
A playwright test should already exist for cytoscape level, so we want to ADD to that test.
Same with the overall system test that includes electron wrapper.

Makes sense?