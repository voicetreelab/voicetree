#!/bin/bash

# Script to cleanup markdownTreeVault folder by moving date folders to markdownTreeVaultDefault
# Leaves .obsidian folder untouched and appends timestamp to avoid overwrites

SOURCE_DIR="markdownTreeVault"
DEST_DIR="markdownTreeVaultDefault"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: $SOURCE_DIR directory not found"
    exit 1
fi

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Move all directories except .obsidian and XcaliDraw from source to destination with timestamp
for dir in "$SOURCE_DIR"/*; do
    if [ -d "$dir" ] && [ "$(basename "$dir")" != ".obsidian" ] && [ "$(basename "$dir")" != "XcaliDraw" ]; then
        dir_name=$(basename "$dir")
        dest_path="$DEST_DIR/${dir_name}_$TIMESTAMP"
        
        echo "Moving $dir to $dest_path"
        mv "$dir" "$dest_path"
        
        if [ $? -eq 0 ]; then
            echo "Successfully moved $dir_name"
        else
            echo "Error moving $dir_name"
        fi
    fi
done

# Move voicetree.log to destination with timestamp if it exists
if [ -f "voicetree.log" ]; then
    log_dest="$DEST_DIR/voicetree_$TIMESTAMP.log"
    echo "Moving voicetree.log to $log_dest"
    mv "voicetree.log" "$log_dest"
    
    if [ $? -eq 0 ]; then
        echo "Successfully moved voicetree.log"
    else
        echo "Error moving voicetree.log"
    fi
else
    echo "voicetree.log not found, skipping"
fi

echo "Cleanup completed. Date folders moved to $DEST_DIR with timestamp $TIMESTAMP"