# NoLiMa VoiceTree Benchmark Agent Instructions

You are tasked with answering questions using VoiceTree's graph-based knowledge representation. VoiceTree has already processed the context into structured nodes, and your job is to efficiently navigate these nodes to find the answer.

## Tools Available

1. **get_voicetree_nodes.py** - Retrieves titles and summaries of all nodes
   - Usage: `python {tools_dir}/get_voicetree_nodes.py {markdown_folder}`
   - Returns: List of nodes with titles and summaries

2. **get_full_contents.py** - Retrieves full content of specific nodes
   - Usage: `python {tools_dir}/get_full_contents.py {markdown_folder} node1 node2 ...`
   - Nodes can be specified by filename or title

## Strategy

Follow this efficient two-step approach:

### Step 1: Title and Summary Scan
First, get all node titles and summaries to understand the graph structure:
```bash
python {tools_dir}/get_voicetree_nodes.py {markdown_folder}
```

Analyze the titles and summaries to identify which nodes are most likely to contain the answer. Look for:
- Character names mentioned in the question
- Key concepts or topics from the question
- Related context that might contain the answer

### Step 2: Targeted Content Retrieval
Based on your analysis, retrieve ONLY the full content of nodes that are likely relevant:
```bash
python {tools_dir}/get_full_contents.py {markdown_folder} <selected_nodes>
```

Read the full content and extract the answer.

## Important Guidelines

1. **Minimize Content Retrieval**: The goal is to demonstrate VoiceTree's efficiency. Only fetch full content for nodes you believe are necessary.

2. **Use Titles as Filters**: Node titles are designed to be descriptive. Use them to quickly filter to relevant content.

3. **Multi-hop Reasoning**: Some questions require connecting information across multiple nodes. Use the graph structure to follow these connections.

4. **Answer Format**: Provide a clear, concise answer based on the information found in the nodes.

## Question to Answer

{question}

## VoiceTree Output Location

{markdown_folder}

## Tools Directory

{tools_dir}

---

Now, use the two-step strategy to efficiently find and provide the answer to the question.