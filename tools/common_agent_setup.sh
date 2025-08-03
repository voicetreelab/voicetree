#!/bin/bash

# Common setup functions for agent scripts

# Function to check required environment variables
check_obsidian_env() {
    if [ -z "$OBSIDIAN_SOURCE_NOTE" ]; then
        echo "Error: OBSIDIAN_SOURCE_NAME is not set"
        echo "This script should be run from a Juggl terminal with the environment variable set"
        exit 1
    fi
}

# Function to assign a random color to the agent
assign_agent_color() {
    # Array of available colors for agents
    local COLORS=("red" "green" "blue" "purple" "orange" "pink" "cyan" "magenta" "indigo" "teal" "brown" "navy" "olive")
    
    # Select a random color from the array
    local RANDOM_INDEX=$((RANDOM % ${#COLORS[@]}))
    export AGENT_COLOR="${COLORS[$RANDOM_INDEX]}"
    
    echo "Assigned color: $AGENT_COLOR to this agent session"
}

# Function to generate dependency graph content
generate_dependency_graph() {
    echo "Generating dependency graph content..."
    
    # Run the graph traversal tool, redirecting stderr to /dev/null to suppress warnings
    python graph_dependency_traversal_and_accumulate_graph_content.py "$OBSIDIAN_VAULT_PATH" "$OBSIDIAN_SOURCE_NOTE" 2>/dev/null
    
    # Check if accumulated.md was created successfully in /tmp/
    if [ -f "/tmp/accumulated.md" ]; then
        # Read the content and export as environment variable
        export DEPENDENCY_GRAPH_CONTENT=$(cat /tmp/accumulated.md)
        # Clean up the generated file
        rm -f /tmp/accumulated.md
    else
        # If graph traversal failed, set empty content
        export DEPENDENCY_GRAPH_CONTENT="[Dependency graph content unavailable]"
    fi
}

# Function to run common setup
run_common_setup() {
    check_obsidian_env
    assign_agent_color
    generate_dependency_graph
    cd ~/repos
}