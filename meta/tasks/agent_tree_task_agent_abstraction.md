We want to improve the organisation of 
  backend/tests/unit_tests/agentic_workflows/ It is currently a 
  bit of a mess. A junior engineer wrote it. We want a clean abstraction whee you can seperate the
   concept of an agent, from the rest of the logic and utility required to 
  run an agent. We want this to have minimal complexity, a very simple API hiding all the complexity, making it easy  to work with.
  
This abstraction may be along the lines of: an AGENT is defined by its WORKFLOW, which has 
 NODES (prompt templates) and EDGES (relationship to another prompt template, plus the data transformer method)
 data transformer takes output from one node, plus the input variables to the agent itself, and maps to the input to the next node in the agent pipeline. This would let someone visualize the agent as a graph.


some things we want:
- a clean abstraction of an agent, with the complexity hidden and a clean api to call an agent with input and get input,
- provides a good testing framework where one can easily test the input to the agent + expected output from agent (live api system tests at the level of an agent)

Some rules to follow:

4. MORE IS NOT ALWAYS BETTER, ANY CHANGE SHOULD BE BALANCED WITH THE TECH DEBT OF ADDING MORE COMPLEXITY.

5. I WILL ONLY EVOLVE MY SYSTEM, NOT CREATE SINGNIFICANTLY CHANGED COPIES. I WILL NOT CREATE FALLBACKS.

6. ISOLATE YOUR DAMN CONCERNS AND KEEP YOUR CONCERNS SEPERATED. AFTER ANY CHANGE MAKE SURE YOU CLEAN UP YOUR ABSTRACTION, SEPARATE CODE INTO FOLDERS, AND HIDE DETAIL BEHIND A CLEAN API SO THAT OUTWARDS COMPLEXITY SHOWN IS MINIMIZED. THEN, AFTER DOING THIS ALSO REVIEW THE GENERAL ARCHITCUTE OF THE COLLECTION OF THESE APIS, DOES THE ARCHITCTURE LEVEL MAKE SENSE, ARE THE APIS THE RIGHT BALANCE OF GENERalITY (TO BE USEFUL) BUT SPECIFICITY & MINIMALNESS TO BE CLEAN & MINIMIZE OUTWARDSLY SHOWN COMPLEXITY.


Be critical of the proposed solution, is it truly the best way to abstract away the concept of an agent? Is it perhaps better NOT to abstract away an agent, and allow each one to be designed differently. 

As you can see from the folder skeleton at backend/text_to_graph_pipeline/agentic_workflows/agents in the future, voice tree plans to have more than one type of agent, hence why we want to buildd this abstraction.


OTHER
You may want to see the nodes for the current implementation here: (backend/text_to_graph_pipeline/agentic_workflows/prompts)