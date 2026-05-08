#!/bin/bash

# Script to run the GSM solver with LLM air traffic control
# Usage: ./run_air_traffic_solver.sh "Your question here"

if [ $# -eq 0 ]; then
    echo "Usage: $0 \"Your question here\""
    exit 1
fi

QUESTION="$1"
MARKDOWN_DIR="backend/benchmarker/output_clustered_hard_16"
TEMP_OUTPUT="/tmp/initial_context.txt"
PROMPT_TEMPLATE="gsm_system/solve_GSM_prompt_hard_16_air_traffic.md"
FINAL_PROMPT="/tmp/gsm_prompt_with_context.md"

echo "Processing question: $QUESTION"
echo "Finding initial relevant context and performing full traversal..."

# First, find the top relevant nodes using TF-IDF
python -c "
import sys
sys.path.insert(0, '.')
from pathlib import Path
from llm_air_traffic_control import find_relevant_nodes_for_question, setup_nltk_stopwords

setup_nltk_stopwords()
markdown_dir = Path('$MARKDOWN_DIR')
question = '''$QUESTION'''

# Find top 10 relevant nodes
relevant_nodes = find_relevant_nodes_for_question(question, markdown_dir, 10)

if relevant_nodes:
    # Save just the filenames to a temporary file for idf_traversal.py
    with open('/tmp/relevant_nodes.txt', 'w') as f:
        for node in relevant_nodes:
            f.write(node['filename'] + '\\n')
    print('Found {} relevant nodes for traversal'.format(len(relevant_nodes)))
else:
    print('No relevant nodes found.')
"

# If we found relevant nodes, run the full traversal
if [ -f "/tmp/relevant_nodes.txt" ]; then
    # Read the relevant nodes into an array (portable way)
    RELEVANT_NODES=()
    while IFS= read -r line; do
        RELEVANT_NODES+=("$line")
    done < /tmp/relevant_nodes.txt
    
    if [ ${#RELEVANT_NODES[@]} -gt 0 ]; then
        echo "Running full traversal on ${#RELEVANT_NODES[@]} initial nodes..."
        
        # Run idf_traversal.py with all the relevant nodes
        python idf_traversal.py "$MARKDOWN_DIR" "${RELEVANT_NODES[@]}" -o "$TEMP_OUTPUT" -n 5
        
        echo "Full traversal completed."
    else
        echo "No nodes to traverse." > "$TEMP_OUTPUT"
    fi
    
    # Clean up
    rm -f /tmp/relevant_nodes.txt
else
    echo "No relevant nodes found for question." > "$TEMP_OUTPUT"
fi

# Create the initial context section
INITIAL_CONTEXT=$(cat "$TEMP_OUTPUT")

# Replace placeholders in the prompt template
cp "$PROMPT_TEMPLATE" "$FINAL_PROMPT"

# Use Python to safely replace the placeholders
python -c "
import sys

# Read the template
with open('$FINAL_PROMPT', 'r') as f:
    content = f.read()

# Read the initial context
with open('$TEMP_OUTPUT', 'r') as f:
    initial_context = f.read()

# Replace placeholders
content = content.replace('{QUESTION}', '''$QUESTION''')
content = content.replace('{INITIAL_RELEVANT_CONTEXT}', initial_context)

# Write the final prompt
with open('$FINAL_PROMPT', 'w') as f:
    f.write(content)
"

echo "Initial context found and injected into prompt."
echo "Prompt saved to: $FINAL_PROMPT"
echo ""
echo "You can now use this prompt with:"
echo "cat $FINAL_PROMPT"
echo ""
echo "Or start the LLM with this context already loaded."

# Optionally, you can pipe this to your LLM interface
# For example, if you have a command like 'claude' or 'llm':
# cat "$FINAL_PROMPT" | your_llm_command

# Clean up temporary file
rm "$TEMP_OUTPUT"