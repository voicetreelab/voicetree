---
node_id: 1
title: Relationship between Target Node and Append Agent (1)
---
### The Append Agent finds the Target Node, essentially being the same concept.

The 'Append Agent' finds the 'Target Node'; they are essentially the same thing. Extracting the target node and append agent.
append_agent_result: AppendAgentResult = await self.append_agent.run(  
    transcript_text=text_chunk,  
    existing_nodes_formatted=relevant_nodes_formatted,  
    transcript_history=transcript_history_context  
)

-----------------
_Links:_
