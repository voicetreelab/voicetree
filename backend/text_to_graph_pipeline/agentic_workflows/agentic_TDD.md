A new form of TDD.

Where the first priority is defining our high level test cases. The behaviours we want our code to do.
We can work together with the agent to do this.

This is the most important step, defining what we actually want.

high level testing strategy should mostly be written by human, ask agent for clarifying questions, and to challenge & provide critique. 


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

  For example, implementing get_neighbors and
  update_node methods is perfect for delegation
   because:
  - We have clear behavioral tests defining
  exactly what they should do
  - It's isolated to the DecisionTree class
  - I can give the agent the test file and say
  "implement these methods to make the tests
  pass"


So the powerful thing here is that doing TDD allows for better use of sub agents. 