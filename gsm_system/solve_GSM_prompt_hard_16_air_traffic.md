You are trying to answer the question: {QUESTION}

This question is about a very large document containing many mathematical relationships. We have compressed this document into a graph structure, each node representing a concept in the text, and its relationship to another node.

This graph is stored as markdown files at /Users/bobbobby/repos/VoiceTree/backend/benchmarker/output_clustered_hard_16 

Your goal is to answer the question above, you will likely need to think of math equations to solve this.

## Initial Relevant Context

Based on TF-IDF analysis for your question, here are the most relevant starting nodes:

{INITIAL_RELEVANT_CONTEXT}

## Tools Available

You have access to an intelligent graph traversal system:

1. **LLM Air Traffic Control** - Use this to explore the graph intelligently:
   ```bash
   python llm_air_traffic_control.py backend/benchmarker/output_clustered_hard_16 "your search query" -n 10
   ```
   - This tool uses TF-IDF to find the most relevant nodes for your query
   - It tracks which nodes you've already seen to avoid duplicates
   - The output will be saved to `traversal_output.md` by default

2. **Additional Specific Files** - If you need to explore specific files:
   ```bash
   python llm_air_traffic_control.py backend/benchmarker/output_clustered_hard_16 "your query" -f file1.md file2.md file3.md
   ```

3. **Reset Seen Nodes** - If you want to start fresh:
   ```bash
   python llm_air_traffic_control.py backend/benchmarker/output_clustered_hard_16 "your query" --reset
   ```

## Strategy

1. Start by analyzing the initial context provided above
2. Identify missing values or dependencies you need to find
3. Use the LLM air traffic control to search for specific values or relationships
4. Build up your understanding incrementally - each query will only show new, unseen information
5. Once you have all the necessary values, solve the mathematical equations to get your answer

## Important Notes

- The system tracks what you've already seen in `seen_nodes.csv`
- Each new query will only show you information you haven't seen before
- This prevents information overload and helps you focus on finding new pieces of the puzzle
- Any values you don't have the direct concrete answer to will exist somewhere in the graph - you just need to search for them intelligently

Example workflow:
1. "I need to find the average number of newborn children per adult crow in South Zoo"
   → Use: `python llm_air_traffic_control.py backend/benchmarker/output_clustered_hard_16 "average newborn children adult crow South Zoo"`

2. "Now I need the total number of adult animals in Jefferson Circus"
   → Use: `python llm_air_traffic_control.py backend/benchmarker/output_clustered_hard_16 "total adult animals Jefferson Circus"`

Remember: The key is to form specific, targeted queries that will help you find the exact values or relationships you need to solve the problem.