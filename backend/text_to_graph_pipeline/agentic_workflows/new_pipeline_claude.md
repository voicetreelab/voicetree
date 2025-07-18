
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
  @backend/text_to_graph_pipeline/agentic_workflows/VoiceTree_Math.md 

  THe pipeline to address this 
  @backend/text_to_graph_pipeline/agentic_workflows/new_pipeline.md 


  here is a plan for the steps required to change our current pipeline, to the new 
  pipeline. @backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_progress_2.md
  They also reference a planning document @backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan_v2.md

  Note there already has been significant progress by engineer.

  Get all the context you need, ask clarifying 
  questions, and ultrathink so that we can 
  write an excellent plan for engineering this 
  new workflow/pipeline :D



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

the powerful thing here is that doing TDD allows for better use of sub agents. 

Gather all your context to understand this task, Ask any clarifying questions you need.