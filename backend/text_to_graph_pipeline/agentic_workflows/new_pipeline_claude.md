
Original task:

I want to improve my agentic workflow for 
  converting text chunk into tree update 
  actions 


  ALl the existing code for doing that is 
  stored in @backend/text_to_graph_pipeline/ 
  predominantly 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/agents/tree_action_decider_agent.py 


  I have new insights into the core algorithm /
   pipeline for doing this.

  Here they are, background: 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/VoiceTree_Math.md 

  THe pipeline to address this 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/new_pipeline.md 


  Let's create a plan for the steps required to
   change our current pipeline, to the new 
  pipeline.

  We should be able to re-use the current 
  segmentation.md prompt with changes (e.g. 
  don't create titles yet)

  Relationship_analysis.md prompt will become 
  the identify_target_node.md prompt

  And then we will need some new logic to do 
  the single abstraction optimiser approach, 
  since it requires knowing which nodes were 
  modified in the last iteration, tree method 
  to get neighbouring nodes. and then new 
  support for UPDATE tree action. 

  Get all the context you need, ask clarifying 
  questions, and ultrathink so that we can 
  write an excellent plan for engineering this 
  new workflow/pipeline :D

YOUR TASK:
previous engineer's plannign document: 
@backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md
They have been tracking their progress here as well. this includes some clarifications I provided. Your task is to continue working on this project.

TDD:
Let's try follow TDD for executing this, 
  since this is quite complex.


SUB AGENT USAGE:
To avoid bloating your own context window, 
  when there is a simple task that does not 
  require deep understanding of the whole 
  problem we are trying to solve, send this off
   to a sub agent as a sub task, so that you 
  can just review their final output, and not 
  pollute your context window with all the 
  details of the task. Don't do this for the 
  actual core implementation work unless it is 
  completely isolateable (i..e the context 
  required to do it you can copmpletely specify
   in one prompt). Do understand? Think. ask 
  clarifying questions if needed


The engineer noted the following heurisitc:

Good for delegation (sub-agent tasks):
  - Well-defined, isolated implementations
  (like "make these specific tests pass")
  - Tasks where I can fully specify
  requirements in one prompt
  - Utility functions, simple methods,
  straightforward refactoring
  - Tasks that don't require understanding the
  broader architectural vision

  Keep in main context (do myself):
  - Core pipeline logic that requires
  understanding the overall architecture
  - Complex prompt engineering that needs
  iterative refinement
  - Integration work that touches multiple
  parts of the system
  - Strategic decisions about how components
  interact

So the powerful thing here is that doing TDD allows for better use of sub agents. 

Gather all your context to understand this task, Ask any clarifying questions you need.