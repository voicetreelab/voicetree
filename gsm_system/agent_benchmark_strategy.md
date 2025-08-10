
Simple strategy

First send initial determinstically chosen most relevant context (i.e. from tf-idf search from question) with the branches up to a depth of 10.

(We already do something very similar for ./claude.sh and common agent setup,, check how that works!!)


Then we give the AGENT (claude) this prompt:
While LLM wants more context to answer question, and more content exists:
    get titles + summaries of unread nodes with python tool (get_unread_nodes.py)
    LLM chooses which ones it wants the full context of.
    