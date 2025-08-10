
Simple strategy

First send initial determinstically chosen most relevant context (i.e. from tf-idf search from question) with the branches up to a depth of 10.

While LLM wants more context to answer question:
    send titles + summaries of unread nodes.
    LLM chooses which ones it wants the full context of.
    