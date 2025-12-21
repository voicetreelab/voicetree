#!/bin/bash

# Common setup functions for agent scripts

# Load VoiceTree configuration if available
#if [ -f "$HOME/.config/voicetree/config" ]; then
#    source "$HOME/.config/voicetree/config"
#fi

# Function to check required environment variables
check_obsidian_env() {
    if [ -z "$OBSIDIAN_SOURCE_NOTE" ]; then
        echo "Error: OBSIDIAN_SOURCE_NOTE is not set"
        echo "This script should be run from a Juggl terminal with the environment variable set"
        exit 1
    fi
}

# Function to generate a unique agent name using round-robin
generate_agent_name() {
    # Simple list of first names
    local FIRST_NAMES=("Alice" "Bob" "Charlie" "Diana" "Eve" "Frank" "Grace" "Henry" "Iris" "Jack" "Kate" "Leo" "Maya" "Noah" "Olivia" "Paul" "Quinn" "Ruby" "Sam" "Tara" "Uma" "Victor" "Wendy" "Xavier" "Yara" "Zoe")
    
    # Tracker file to maintain state across sessions
    local TRACKER_FILE="$(dirname "$0")/state/.agent_names_tracker"
    
    # Read used names from tracker
    local USED_NAMES=()
    if [ -f "$TRACKER_FILE" ]; then
        while IFS=',' read -r name timestamp; do
            # Skip comment lines
            [[ "$name" =~ ^#.*$ ]] && continue
            [ ! -z "$name" ] && USED_NAMES+=("$name")
        done < "$TRACKER_FILE"
    fi
    
    # Find next available name in round-robin fashion
    local SELECTED_NAME=""
    for name in "${FIRST_NAMES[@]}"; do
        local NAME_USED=false
        for used in "${USED_NAMES[@]}"; do
            if [ "$name" = "$used" ]; then
                NAME_USED=true
                break
            fi
        done
        
        if [ "$NAME_USED" = false ]; then
            SELECTED_NAME="$name"
            break
        fi
    done
    
    # If all names are used, reset and start from beginning
    if [ -z "$SELECTED_NAME" ]; then
        echo "# Reset at $(date)" > "$TRACKER_FILE"
        SELECTED_NAME="${FIRST_NAMES[0]}"
        echo "All names used, resetting to: $SELECTED_NAME" >&2
    fi
    
    # Record the selected name
    echo "$SELECTED_NAME,$(date -Iseconds)" >> "$TRACKER_FILE"
    
    echo "$SELECTED_NAME"
}

# Function to assign agent name and color
assign_agent_identity() {
    local SOURCE_NOTE_PATH="$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE"
    
    # First check if source note contains an agent_name in frontmatter
    if [ -f "$SOURCE_NOTE_PATH" ]; then
        # Extract agent_name from YAML frontmatter if it exists
        local EXISTING_NAME=$(grep -A 20 '^---$' "$SOURCE_NOTE_PATH" | grep '^agent_name:' | sed 's/agent_name: *//' | tr -d '\r\n' | head -1)
        
        if [ ! -z "$EXISTING_NAME" ]; then
            export AGENT_NAME="$EXISTING_NAME"
            echo "Using existing agent name from source note: $AGENT_NAME"
        fi
        
        # Extract color from YAML frontmatter if it exists
        local EXISTING_COLOR=$(grep -A 20 '^---$' "$SOURCE_NOTE_PATH" | grep '^color:' | sed 's/color: *//' | tr -d '\r\n' | head -1)
        
        if [ ! -z "$EXISTING_COLOR" ]; then
            export AGENT_COLOR="$EXISTING_COLOR"
            echo "Using existing color from source note: $AGENT_COLOR"
        fi
    fi
    
    # If no agent name found, generate one
    if [ -z "$AGENT_NAME" ]; then
        export AGENT_NAME=$(generate_agent_name)
        echo "Generated agent name: $AGENT_NAME"
    fi
    
    # If no color found, assign a random one
    if [ -z "$AGENT_COLOR" ]; then
        # Array of available colors for agents
        local COLORS=("red" "green" "blue" "purple" "orange" "pink" "cyan" "magenta" "indigo" "teal" "brown" "navy" "olive")
        
        # Select a random color from the array
        local RANDOM_INDEX=$((RANDOM % ${#COLORS[@]}))
        export AGENT_COLOR="${COLORS[$RANDOM_INDEX]}"
        
        echo "Assigned random color: $AGENT_COLOR to agent $AGENT_NAME"
    fi
}

# Deprecated function for backward compatibility - now calls assign_agent_identity
assign_agent_color() {
    assign_agent_identity
}

# Function to generate dependency graph content
generate_dependency_graph() {
    echo "Generating dependency graph content..."
    
    # Run the graph traversal tool, capturing stderr for error reporting
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ERROR_OUTPUT=$(python3 "$SCRIPT_DIR/bidirectional_traversal.py" "$OBSIDIAN_VAULT_PATH" "$OBSIDIAN_SOURCE_NOTE" -o /tmp/accumulated.md 2>&1)
    EXIT_CODE=$?
    
    # Check if accumulated.md was created successfully in /tmp/
    if [ -f "/tmp/accumulated.md" ]; then
        # Read the content and export as environment variable
        export DEPENDENCY_GRAPH_CONTENT=$(cat /tmp/accumulated.md)
        # Clean up the generated file
        rm -f /tmp/accumulated.md
    else
        # If graph traversal failed, include the actual error message
        if [ $EXIT_CODE -ne 0 ]; then
            export DEPENDENCY_GRAPH_CONTENT="[Dependency graph error - Exit code: $EXIT_CODE]
Error output:
$ERROR_OUTPUT"
        else
            export DEPENDENCY_GRAPH_CONTENT="[Dependency graph content unavailable - No error output but /tmp/accumulated.md not created]"
        fi
    fi
}

# Function to read source note content  
read_source_note_content() {
    echo "Reading source note content..."
    
    # Construct the full path to the source note
    local SOURCE_NOTE_PATH="$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE"
    
    # Check if the source note exists and read its content
    if [ -f "$SOURCE_NOTE_PATH" ]; then
        export OBSIDIAN_SOURCE_NOTE_CONTENT=$(cat "$SOURCE_NOTE_PATH")
    else
        export OBSIDIAN_SOURCE_NOTE_CONTENT="[Source note content unavailable: $SOURCE_NOTE_PATH not found]"
    fi
}

# Function to run common setup
run_common_setup() {
    check_obsidian_env
    assign_agent_color
    generate_dependency_graph
    read_source_note_content
    # Note: The calling script (claude.sh/gemini.sh) is responsible for changing to the repos directory
}