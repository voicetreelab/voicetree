We have two options.

- go back to 88b7acb86 "Integraated graph agent into VT"
since after this vibecodign went way too hard
    - Biggest problem, multiple versions of files. 
    - The system is still in development mode, so it is bettter to just have only one version at any given time, and evolve the system from A to B incrementally.
    - Second problem, tests sooooo messy.
      - have an excellent integration test setup. Mock the workflow output.
      - and then have one system test mocked with specific LLM calls mocked
      - In-fact, if we have system test, why would we need the integration tests? yes only have e2e system ttst for mocked version.
      - must must must read the code  output from agent.
      - can't just give it a yolo task like implement TROA (sysstem got so messed up from that)
       

- or push through

- why go back and re-implement. changes compound

- okay, let's try this. If within an hour, the output is actually quality wise fine stay and push throuhg. 

- but  remember as well from the old commit there have been no actual functional changes, just slop. yes but some stuff nicely done like the agentic architecture


Plan: first get our integration & system tests working

- Live system test should test the more general case,
  - where we already have about 5-15 (? tradeoff between test complexity and realism) nodes in the tree
  - where the last sentence in chunk was labelled as unfinished 
  (so that the next chunk will hopefully finish off the last sentence)