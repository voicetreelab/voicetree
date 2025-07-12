Option 1: just continue with LLM decides APPEND or CREATE at target node, and deterministally apply this. Put this in relationship analysis prompt since it is v similar and usses most overlap with reasonsing for to deciding relationship. 

Option 2.

Keep an integrator prompt, but make it a smart integrator!

After relationship analysis stage

give smart integrator the full transitive connection to a node for each subchunk

e.g. maybe chunk {relationship} chunk {relationship} node

but here we incude ALL the content for the node and soon to be connected chunks, as if we were just appending the connected chunks to the selected node.

Then we ask the smart integrator to restructure this now bloated node, allowing it to split into subnodes as it sees fit.

This way we get the append or create new node outcome, but are borders are more flexible allowing for more meaningful children nodes 

