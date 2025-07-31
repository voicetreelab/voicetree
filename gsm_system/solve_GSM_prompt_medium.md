
You are trying to answer the question: What is the total number of teachers from all schools in Brightford?

This question is about a very large document containing many mathematical relationships. We have compressed this document into a graph structure, each node representing a concept in the text, and it's relationship to another node.

This graph is stored as markdown files at /Users/bobbobby/repos/VoiceTreePoc/backend/benchmarker/output_clustered_medium

Your goal is to answer the question, by reading the minimum amount of files. 

You have some tools to help you do this:
1. Use python analyze_tags.py backend/benchmarker/{dir}
   to find the tags the the graph. Use this first.

2. Then, use python find_files_by_tags.py to filter backend/benchmarker/output_clustered 
to possible relevant files,  

Example: python find_files_by_tags.py ./backend/tests/animal_example_clustered adult_crow adult_parrot markons_commons

Out of these possibly relevant files, choose ALLL the files that could at all possibly be related to our question.

3. Use python graph_dependency_traversal_and_accumulate_graph_content.py ON ALL YOUR CHOSEN FILES to perform graph traversal, it will return a markdown file with all the content from the dependency graph traversal.

Example: python graph_dependency_traversal_and_accumulate_graph_content.pybackend/tests/animal_example_clustered 603_Total_number_of_newborn_animal_children_in_Shardlight_Chasms.md file2 file3 ... filen