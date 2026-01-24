---
position:
  x: 377.6416332743933
  y: 120.55266695210226
isContextNode: false
node_id: 1
---
### The Append Agent finds the Target GraphNode, essentially being the same concept.

The 'Append Agent' finds the 'Target GraphNode'; they are essentially the same thing. Extracting the target node and append agent.
append_agent_result: AppendAgentResult = await self.append_agent.run(  
    transcript_text=text_chunk,  
    existing_nodes_formatted=relevant_nodes_formatted,  
    transcript_history=transcript_history_context  
)

-----------------
_Links:_
