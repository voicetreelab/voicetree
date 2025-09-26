#!/usr/bin/env python3
"""
Script to create folder notes for all directories in VoiceTree.
Creates a markdown file with the same name as each folder, containing %%tree%% at the top.
Does not overwrite existing folder notes.
"""

import os
from pathlib import Path

def create_folder_notes(root_path):
    """
    Create folder notes for all directories in the given root path.

    Args:
        root_path (str): The root directory to process
    """
    root = Path(root_path)

    if not root.exists():
        print(f"Error: Path {root_path} does not exist")
        return

    created_count = 0
    skipped_count = 0

    # Walk through all directories
    for dir_path in root.rglob("*"):
        if dir_path.is_dir():
            # Skip .obsidian and other hidden directories
            if any(part.startswith('.') for part in dir_path.parts):
                continue

            # Create folder note path (same name as folder with .md extension)
            folder_note_path = dir_path / f"{dir_path.name}.md"

            # Check if folder note already exists
            if folder_note_path.exists():
                print(f"Skipping existing folder note: {folder_note_path}")
                skipped_count += 1
                continue

            # Create the folder note
            try:
                with open(folder_note_path, 'w', encoding='utf-8') as f:
                    f.write("%%tree%%\n")
                print(f"Created folder note: {folder_note_path}")
                created_count += 1
            except Exception as e:
                print(f"Error creating folder note {folder_note_path}: {e}")

    print(f"\nSummary:")
    print(f"Created: {created_count} folder notes")
    print(f"Skipped: {skipped_count} existing folder notes")

if __name__ == "__main__":
    voicetree_path = "/Users/bobbobby/repos/knowledge/VoiceTree"
    create_folder_notes(voicetree_path)