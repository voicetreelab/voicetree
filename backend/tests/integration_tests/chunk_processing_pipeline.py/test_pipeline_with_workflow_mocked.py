"""
This test aims to test the chunk processing pipeline, which does:

entrypoint -> process_new_text_and_update_markdown (new text) -> runs agentic workflow -> processses results -> updated tree. -> updated markdown

Here we are going to mock the agentic workflow part, to randomlly return CREATE or UPDATE IntegrationDecision (or soon to be named TreeActions) 

We want to test the invariants here, not impplementation details.

We will randomly call entrypoint with random sentences between 1-110 words in length. Then we will mock agentic workflow to return a TreeAction for whatever was in the buffer at the time it was full, break that into sub-chunks randomly dividing the buffer between 1x-5x, so between 1 to 5 subchunks. Each of these should randomly be a CREATE / APPEND action, with the subchunk text being real text from the buffer and complete. Choose a random existing node each time for the treeACtion.

Then after this is done, we will test the following invariants at the MARKDOWN level:

- The number of nodes matches init + created
- If you accumulate all the text within the tree (functional acc of tree), then all the appended and created text is contained within this, the length matches what is expected (= new + old)
- Some way of testing structure / relationships expected? Number of relationship (links) matches whhat we expect (orig + num creates?) 



See backend/tests/module_tests/test_apply_tree_actions.py for a similar concept.
"""