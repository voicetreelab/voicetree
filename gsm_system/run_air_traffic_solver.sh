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
echo "Finding initial relevant context..."

# Run the initial TF-IDF search to get top 10 relevant nodes
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
    print('Found {} relevant nodes:'.format(len(relevant_nodes)))
    for node in relevant_nodes:
        print('- {} (similarity: {:.4f})'.format(node['filename'], node['similarity']))
        # Read and print the content of each node
        content_path = markdown_dir / node['filename']
        try:
            with open(content_path, 'r') as f:
                content = f.read()
                print('\\n--- Content of {} ---'.format(node['filename']))
                print(content)
                print('\\n' + '='*80 + '\\n')
        except:
            print('Error reading {}'.format(node['filename']))
else:
    print('No relevant nodes found.')
" > "$TEMP_OUTPUT"

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