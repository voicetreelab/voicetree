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


SOMEHOW FIND THE FUCKING ABSTRACTION SYSTEM

- nodes, edges, data mappers 

1. Get current system extremely clean:

2. Get all tests green + pipeline green. (doing, unit tests + integration tests, pipeline not yet)  DONE
2. (Implement serena) DONE
2. USE PYDANTIC AI DONE
2. REMOVE  node_extraction.txt DONE
3. implement better backend arch DONE
3. PIPELINE green (just integration tests ) DONE
3. benchmarker working DONE
3. run benchmarker, is output reasonable? Can claude follow guide? 
Problems with benchmarker:
- Sometimes output not generated (WHY NOT?). 
- Also, can we please send output to the same folder as the benchmarker, i.e. benchmarker/output (and have input in a sibling input folder)
- Debug logs growing indefintely: backend/text_to_graph_pipeline/agentic_workflows/debug_logs 
- debug logs contain stupid """  stage_name: 'Segmentation'
  stage_type: 'segmentation'
  prompt_name: 'segmentation'""" we shouldn't even have these three different duplicated names. Make sure system only uses one.
- segmentation prompt is compressing subchunks / segments with "..." e.g.  """OUTPUT VARIABLES:
  chunks: [
    0: {'name': 'Markdown Conversion', 'text': 'And I want first, I want it to build into markdown, convert that into markdown, and then I want to c...', 'is_complete': True}
    1: {'name': 'First Task', 'text': "So, that's the first thing I want to do.", 'is_complete': True}
    2: {'name': 'Incomplete Thought', 'text': 'Uh,', 'is_complete': False}
  ]"""
    - could this be because of a predefined output token length?
    - how can we encourage the prompt not to do this. Or is it better to restructure it to return something else 


3. Improve system to have sound behaviour from benchmark outputs DOING
  - Need to undertsand if their is a low complexity solution for TADA. Wait till thought complete with cheap model? Punctuation?
  - Compress prompts
  - Better examples 


4. implement better agentic workflow arch (nodes, edges, transformers) TODO

- Remove test_chunk_boundaries.py and replace with 

# LOW PRIO
5. imlepement complexity score
6. implement proper mocked system test
7. implement proper live system test, two chunk processes to existing tree + quality sanity check


I HAD a good idea, what was it? Oh yea, complexity via mermaid diagrams, number of nodes and number of edges. mhmm not super soundx