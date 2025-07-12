

TODO
1. remove this, and do it deterministacally.
    *   `text`: The original `text` of the sub-chunk from the input (required, string).

    also don't include is_complete true in input to future prompts 


2. better format for input nodes (name + summary)

3. circular references within input nodes 

4. a node may have no current relevant node, but this is just a sign of over fragmentation by segmentor
we either allow relationshiper to re-merge, or change integration prompt to be more dynamic, work item based.

If we decompose into work items first, and have W1, W2, W1, do we merge W1 before giving to relationshipper?


(leaving some unprocessed content?)