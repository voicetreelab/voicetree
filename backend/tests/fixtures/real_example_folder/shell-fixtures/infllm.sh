#!/bin/bash

# Infinite LLM - Query the VoiceTree markdown vault with context retrieval

# Set the script directory and markdown vault path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Find the most recent markdown vault subdirectory (format: YYYY-MM-DD or YYYY-MM-DD_*)
LATEST_VAULT=$(ls -d "${SCRIPT_DIR}"/20*-*-* 2>/dev/null | sort -r | head -1)
MARKDOWN_VAULT="${LATEST_VAULT:-${SCRIPT_DIR}}"
BACKEND_DIR="$(dirname "${SCRIPT_DIR}")/backend"
RETRIEVE_CONTEXT="${BACKEND_DIR}/context_retrieval/retrieve_context.py"

# Function to display usage
show_usage() {
    echo "Usage: $0 \"<query>\""
    echo ""
    echo "Query the VoiceTree markdown vault using context retrieval and Claude API."
    echo ""
    echo "Examples:"
    echo "  $0 \"How does the authentication system work?\""
    echo "  $0 \"What is the architecture of the voice tree?\""
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    exit 0
}

# Function to display error and exit
error_exit() {
    echo "Error: $1" >&2
    exit 1
}

# Parse command-line arguments
if [ $# -eq 0 ]; then
    error_exit "No query provided. Use -h for help."
fi

if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_usage
fi

QUERY="$1"

# Validate markdown vault path exists
if [ ! -d "$MARKDOWN_VAULT" ]; then
    error_exit "Markdown vault directory not found: $MARKDOWN_VAULT"
fi

# Validate retrieve_context.py exists
if [ ! -f "$RETRIEVE_CONTEXT" ]; then
    error_exit "retrieve_context.py not found: $RETRIEVE_CONTEXT"
fi

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    error_exit "Python 3 is required but not found in PATH"
fi

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    error_exit "claude CLI is required but not found in PATH. Please install it first."
fi

echo "🔍 Retrieving context for query: \"$QUERY\"" >&2
echo "" >&2

# Call retrieve_context.py to get relevant context
if [ "$INFLLM_DEBUG" = "1" ]; then
    # Show debug output when debugging
    CONTEXT=$(python3 "$RETRIEVE_CONTEXT" "$MARKDOWN_VAULT" "$QUERY" 2>&1)
else
    # Hide debug output in normal use
    CONTEXT=$(python3 "$RETRIEVE_CONTEXT" "$MARKDOWN_VAULT" "$QUERY" 2>/dev/null)
fi
RETRIEVAL_EXIT_CODE=$?

# Only show debug info if INFLLM_DEBUG is set
if [ "$INFLLM_DEBUG" = "1" ]; then
    echo "🔧 DEBUG: Using markdown vault directory: $MARKDOWN_VAULT" >&2
    echo "🔧 DEBUG: Context retrieval exit code: $RETRIEVAL_EXIT_CODE" >&2
    echo "🔧 DEBUG: Context length: ${#CONTEXT} characters" >&2
fi

# Check if context retrieval succeeded
if [ $RETRIEVAL_EXIT_CODE -ne 0 ]; then
    error_exit "Failed to retrieve context. Please check the query and try again."
fi

# Check if context is empty or contains "No context found"
if [ -z "$CONTEXT" ] || [[ "$CONTEXT" == *"No context found for the given query."* ]]; then
    echo "⚠️  No relevant context found for your query." >&2
    echo "" >&2
    # Still send to Claude without context
    PROMPT="I couldn't find any relevant context in the markdown vault for the query: \"$QUERY\"

Please provide a general answer based on your knowledge."
else
    echo "✅ Found relevant context!" >&2
    # Format prompt combining context and query
    PROMPT="Based on the following context retrieved from the VoiceTree markdown vault:

$CONTEXT

Please answer this question: $QUERY

Provide a clear, concise answer based on the context above. If the context doesn't fully answer the question, indicate what information is missing."
fi

echo "🤖 Sending to Claude API..." >&2
echo "$PROMPT"
echo "" >&2

# Send to Claude API with proper flags
claude --dangerously-skip-permissions 2>/dev/null "$PROMPT"
CLAUDE_EXIT_CODE=$?

# Check if Claude API call succeeded
if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
    echo "" >&2
    error_exit "Claude API call failed. Please check your Claude CLI configuration."
fi

echo "" >&2
echo "✅ Done!" >&2