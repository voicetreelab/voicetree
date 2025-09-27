Okay come up with a plan on how to do this. I want you to use sub-agents where possible to execute tasks in parallel or sequentially, but I want you to
minimise the work you're doing yourself. However, you have to make sure that each sub-task or sub-agent, when you spawn them with ToolCall, you give
them a very constrained task with a small scope that is very clear with clear inputs and outputs. For example, either a function or a class or a module.
That doesn't have any touch points, so that it can be done in isolation and is somewhat low complexity. And then you are going to be the one
orchestrating them and putting all their work together. So come up with a plan on how best to do that.


Show me your task tree (the tasks, their dependencies, what can be parallelized) etc. as an ASCII Tree

-----------

give the agent much more specific context. Tell them what exact files they will need to make. Actually make the folder and file yourself first so
it doesn't need to do that. That way, it's more intuitive and less ambiguous for the agent to know what to do. Also, make sure to give them the useful
coordinate systems and positioning logic documentation that I sent over with all the gotchas. Otherwise, it's just going to run in circles if it doesn't
know that.

--------

also make a TDD test file that will test some of the conversions so that we know beforehand if the agent actually did it correctly. Does
that make sense?

Test function, not implementatoin detail****
