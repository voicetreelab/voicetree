
You are trying to answer the question: 

This question is about a very large document. We have compressed this document into a graph structure, each node representing a concept in the text, and it's relationship to another node.

This graph is stored as markdown files at backend/benchmarker/output_clustered 

Your goal is to answer the question, by reading the minimum amount of files. 

You have some tools to help you do this:
1. Use @analyze_tags.py to find the tags the the graph. Use this first.
2. Then, use @find_files_by_tags.py to filter backend/benchmarker/output_clustered to only relevant files,  
3. Use @accumulate_graph_content.py to perform graph traversal, it will return a markdown file with all the content from the dependency graph traversal.

Use that to answer the question: