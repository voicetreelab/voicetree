You are trying to answer the question: How many adult parrot does Mayer Aquarium have?

This question is about a very large document containing many mathematical relationships. We have compressed this document into a graph structure, each node representing a concept in the text, and it's relationship to another node.

This graph is stored as markdown files at /Users/bobbobby/repos/VoiceTree/backend/benchmarker/output_clustered_hard_16 

Your goal is to answer the question above, you will likely need to think of math equations to solve this.
Any values you don't have the direct concrete answer to, the solution to their vlue will exist in the output folder, 
you will just have to infer their value, using your tools.

For example, to figure out how the average number of x in place y, you will need to use your search tools to figure
out what types of x exist in y.

You have some tools to help you do this:
1. Use python analyze_tags.py backend/benchmarker/{dir}
   to find the tags the the graph. Use this first.

2. Then, use python find_files_by_tags.py to filter backend/benchmarker/{dir} 
to possible relevant files,  

Example: python find_files_by_tags_AND.py ./backend/tests/animal_example_clustered adult_crow adult_parrot markons_commons that will match files that contain atleast all these tags 

Out of these possibly relevant files, choose ALLL the files that could at all possibly be related to our question.

3. Use python graph_dependency_traversal_and_accumulate_graph_content.py ON ALL YOUR CHOSEN FILES to perform graph dependency traversal, it will return a markdown file with all the content from the dependency graph traversal.

Example: python graph_dependency_traversal_and_accumulate_graph_content.pybackend/tests/animal_example_clustered 603_Total_number_of_newborn_animal_children_in_Shardlight_Chasms.md file2 file3 ... filen