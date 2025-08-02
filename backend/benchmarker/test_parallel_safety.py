#!/usr/bin/env python3
"""Test parallel safety of benchmarker runs."""

import asyncio
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from backend.benchmarker.src.quality_LLM_benchmarker import process_single_transcript

async def test_parallel_runs():
    """Test that multiple benchmarker runs can execute in parallel safely."""
    
    # Define two different test transcripts
    test_transcripts = [
        {
            "file": "backend/benchmarker/input/voiceTree_clustering.txt",
            "name": "VT Clustering Test 1",
            "max_words": 100,
            "processing_mode": "line",
        },
        {
            "file": "backend/benchmarker/input/og_vt_transcript.txt", 
            "name": "VT Original Test 2",
            "max_words": 100,
            "processing_mode": "word",
        }
    ]
    
    print("Starting parallel test with 2 transcripts...")
    print(f"Transcript 1: {test_transcripts[0]['name']}")
    print(f"Transcript 2: {test_transcripts[1]['name']}")
    print("\n" + "="*60 + "\n")
    
    # Process both transcripts in parallel
    results = await asyncio.gather(
        process_single_transcript(test_transcripts[0]),
        process_single_transcript(test_transcripts[1]),
        return_exceptions=False
    )
    
    # Check results
    print("\n" + "="*60)
    print("PARALLEL TEST RESULTS")
    print("="*60)
    
    for i, (name, success, error) in enumerate(results):
        if success:
            print(f"✓ Transcript {i+1} ({name}): SUCCESS")
        else:
            print(f"✗ Transcript {i+1} ({name}): FAILED - {error}")
    
    # Check if both output directories exist
    output_dirs = [
        "backend/benchmarker/output/voiceTree_clustering",
        "backend/benchmarker/output/og_vt_transcript"
    ]
    
    print("\nOutput directory check:")
    for dir_path in output_dirs:
        if os.path.exists(dir_path):
            print(f"✓ {dir_path} exists")
        else:
            print(f"✗ {dir_path} NOT FOUND")
    
    # Check backups
    print("\nBackup directory check:")
    backup_dir = "backend/benchmarker/output_backups"
    if os.path.exists(backup_dir):
        backups = [f for f in os.listdir(backup_dir) if f.endswith("_backup_" + asyncio.get_event_loop().time().strftime("%Y%m%d")[0:8])]
        print(f"Found {len(os.listdir(backup_dir))} total backups")
    else:
        print("No backup directory found")

if __name__ == "__main__":
    asyncio.run(test_parallel_runs())