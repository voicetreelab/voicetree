we have four different layers of state:

The 4 State Layers

```
EDITOR ←→ MEM ←→ GRAPH UI
              ↕
              FS
```


We react to changes from 3 layers of state:

- onFsEventIsDbChangePath: The filesystem, which is considered our database, to handle external changes. Here we listen to chokidar events.

- onFloatingEditorChange: Our own floating editors, which is direct function call model from CM6 onUserChange. not really listener. This for now is only a change to the markdown content of a GraphNode, which can then result in edge changes as well.

- onUIChangePath: our own modifications to graph state from our app logic, proc'd by a user action. 



