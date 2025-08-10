Help me fix the forward unresolved dependencies in
@backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question

These will look like _Still_Requires:_
- number of public highschool in Evervale City

Change to

_Still_Requires:_
- [[file_containing_number_of_public_highschool_in_evervale_City.md]] if that file,
  or a dependent of that file contains the dependent value


You have some tools to help you accomplish this. 1. Use python analyze_tags.py
backend/benchmarker/{dir}
to find the tags the the graph.


python find_files_by_tags.py to filter backend/benchmarker/output_clustered
to possible relevant files,

Example: python find_files_by_tags.py ./backend/tests/animal_example_clustered
adult_crow adult_parrot markons_commons


you can also perform graph dependency traversal with
Example: python accumulate_graph_content.py backend/tests/animal_example_clustered
603_Total_number_of_newborn_animal_children_in_Shardlight_Chasms.md file2 file3 ...
filen

If one of the dependencies is proving hard to find the taret for, don't worry just
save it for later and tell me.
⎿  Listed directory
backend/benchmarker/output/igsm_op17_ip20_force_True_0_problem_question/

⏺ I'll help you fix the forward unresolved dependencies. Let me start by analyzing the
graph structure and understanding what dependencies need to be resolved.

