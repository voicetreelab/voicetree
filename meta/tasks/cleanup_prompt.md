We want to improve the organisation of 
  @backend/tests/unit_tests/agentic_workflows/ It is currently a 
  bit of a mess. We want an abstraction whee you can seperate the
   concept of an agent, from the rest of the logic required to 
  run an agent i.e. an agent is defined by the nodes (prompt 
  template) and edges (relationship to another prompt template, 
  plus the data transformer method)
  ⎿  Listed directory backend/tests/unit_tests/agentic_w