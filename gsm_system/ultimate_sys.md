Faster, cheaper (fewer input tokens), higher accuracy LLMs with VoiceTree context agent.
+ potential for infinite context length conversations. (kind-of)

User enters query Q0, relevant to long history of chat context (e.g. 100s of back and forth messages, or a long document, or ...)

1. build VoiceTree (concept tree) which losslessly compresses the context history

Start with Qn=Q0
1.5, perform semantic relevancy vector search for Qn against all UNSEEN nodes.
2. given Qn, pass in relevant dependency traversals, from root nodes, to the 5 most relevant nodes to Qn,
   a. also include some information about the neighborhood around the dep trav. including future children of last node, 
   b. the information you include is just names, then summaries as we get closer, then as we get into immediate neighbourhood (distance 5 away perhaps) we start to include FULL node contents: title + summary + content
   c. also include names + summaries of the next 10 most relevant nodes in tree, and just names of the 10 after that most relevant.  ONLY for nodes we didn't already pass in b.

3. LLM responds! Either with 
 a. the answer to Q0 (end loop!), 
 b. or "I NEED MORE CONTEXT", and Qn+1 which is a sentence (or todo perhaps multiple question sentences?) describing what other context it needs or is missing. (todo, seeing a problem here, what if the answer is fuzzy,  how will it know it has enough context yet?)
 c. AND it mentions the names of nodes it has seen that it would like fully expanded since they may be relevant.

Go to step 2 with Qn+1 and expanded nodes,