#!/usr/bin/env python3
"""
Example usage of the LLM Air Traffic Control system
"""

from pathlib import Path

from llm_air_traffic_control import SeenNodesTracker
from llm_air_traffic_control import process_question


def example_usage():
    """Example of how to use the air traffic control system."""
    
    # Setup
    markdown_dir = Path("backend/benchmarker/output_clustered_hard_16")
    seen_tracker = SeenNodesTracker(Path("seen_nodes_example.csv"))
    
    # First question - will find top 10 relevant nodes
    question1 = "How many adult parrots does Mayer Aquarium have?"
    output1 = Path("output_question1.md")
    
    print("Processing first question...")
    result1 = process_question(
        question=question1,
        markdown_dir=markdown_dir,
        seen_tracker=seen_tracker,
        output_path=output1,
        num_initial_nodes=10
    )
    print(f"Result: {result1}\n")
    
    # Second question - will avoid already seen nodes
    question2 = "What is the relationship between adult parrots and adult crows?"
    output2 = Path("output_question2.md")
    
    print("Processing second question...")
    result2 = process_question(
        question=question2,
        markdown_dir=markdown_dir,
        seen_tracker=seen_tracker,
        output_path=output2,
        num_initial_nodes=10
    )
    print(f"Result: {result2}\n")
    
    # Third call - agent wants to see specific files not yet seen
    question3 = "Tell me more about the calculations"
    output3 = Path("output_question3.md")
    additional_files = [
        "77_Number_of_Adult_Crow_in_Mayer_Aquarium.md",
        "122_Number_of_Adult_Fox_in_Heavenspire_Peak.md"
    ]
    
    print("Processing third question with additional files...")
    result3 = process_question(
        question=question3,
        markdown_dir=markdown_dir,
        seen_tracker=seen_tracker,
        output_path=output3,
        num_initial_nodes=5,
        additional_files=additional_files
    )
    print(f"Result: {result3}\n")
    
    print(f"Total nodes seen across all queries: {len(seen_tracker.seen_nodes)}")


if __name__ == "__main__":
    example_usage()