Since working on voiceTree I have stumbled upon an absolute killer use case. Having LLMs themselves use VoiceTree to structure their context. Recursive context management datastrcuture.

So LLMs get context degradation / context bloat. They perform worse the longer the context input is.

A core problem is that current LLM attention architecture has quadratic complexity

My solution is to stop feeding LLMs linear text and instead represent the context as a recursive abstraction tree.

And funny enough I have been building a tool that does just that: VoiceTree, continuously process chunks of text to build the ideal abstraction tree to optimally compress the content's meaning.


WE WANT to test on this dataset.

APPROACH: (assumes we can separate context from question.)

STEP 1: Build VoiceTree for a given dataset.
Input: context, Q

VoiceTree(context) -> markdown files

Output:
markdown files + high level tree view

STEP 2: ask LLM which nodes it would like access to for answser

Input: LLM gets high level tree view, list of nodes and their summaries

Flow:
LLM decides which nodes it would like in its content to best answer Q 
(ideally recursively, where each node can itself be a tree)
we do this by -> call_LLM(tree_view) -> [list of chosen md files]


Step 3: call LLM with reduced context to just what is relevant.
-> call LLM(chosen_nodes + q) ing 

