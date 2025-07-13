

TODO
1. remove this, and do it deterministacally.
    *   `text`: The original `text` of the sub-chunk from the input (required, string).

    also don't include is_complete true in input to future prompts 

     One improvement I want to make to @backend/tests/unit_tests/agentic_workflows/ is to not rely on the text input not having to be recreated word for    │
│   word by each LLM, or atleast not trusting that it gets it right everytime.   


2. better format for input nodes (name + summary) provide this to ALL prompts if relevant 

4. a node may have no current relevant node, but this is just a sign of over fragmentation by segmentor
we either allow relationshiper to re-merge, or change integration prompt to be more dynamic, work item based.

If we decompose into work items first, and have W1, W2, W1, do we merge W1 before giving to relationshipper?

