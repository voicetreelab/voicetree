#!/usr/bin/env python3
"""
Enhanced Quality Benchmarker for TADA + TROA System
Integrates with existing VoiceTree Testing & Debug Guide infrastructure
"""

import asyncio
import logging
import shutil
import time
import subprocess
import os
import sys
from datetime import datetime
import json
import re

# Add parent directories to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..')))

import google.generativeai as genai
from google.generativeai import GenerativeModel

# Import enhanced system
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))
from enhanced_transcription_processor import create_enhanced_transcription_processor
from tree_manager.decision_tree_ds import DecisionTree
import settings
import PackageProjectForLLM

# Configure Gemini API
genai.configure(api_key=settings.GOOGLE_API_KEY)

# Constants (following existing guide structure)
REQUESTS_PER_MINUTE = 15  # to avoid breaching 15RPM gemini limit
SECONDS_PER_REQUEST = 60 / REQUESTS_PER_MINUTE
OUTPUT_DIR = "oldVaults/VoiceTreePOC/QualityTest_Enhanced"
QUALITY_LOG_FILE = "quality_log_enhanced.txt"
LATEST_QUALITY_LOG_FILE = "latest_quality_log_enhanced.txt"
LATEST_RUN_CONTEXT_FILE = "latest_run_context_enhanced.json"
WORKFLOW_IO_LOG = "backend/agentic_workflows/workflow_io.log"


def setup_output_directory():
    """Handles backing up previous results and setting up a clean output directory."""
    if os.path.exists(OUTPUT_DIR):
        # Create a timestamped backup directory name
        backup_dir_base = "oldVaults/VoiceTreePOC/OLDQualityTest_Enhanced"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = f"{backup_dir_base}_{timestamp}"
        
        # Ensure the base backup directory exists
        os.makedirs(os.path.dirname(backup_dir_base), exist_ok=True)
        
        print(f"Backing up existing output from {OUTPUT_DIR} to {backup_dir}")
        shutil.copytree(OUTPUT_DIR, backup_dir)
        
        # Also move the log file if it exists
        voicetree_log_file = "voicetree.log"
        if os.path.exists(voicetree_log_file):
            shutil.move(voicetree_log_file, os.path.join(backup_dir, voicetree_log_file))
            
        # Clear the output directory for a fresh run
        shutil.rmtree(OUTPUT_DIR)
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)


async def process_transcript_with_enhanced_voicetree(transcript_file, max_words=None, enable_troa=False):
    """
    Processes a transcript file with Enhanced VoiceTree (TADA + optional TROA)
    
    Args:
        transcript_file: Path to transcript file
        max_words: Optional word limit
        enable_troa: Whether to enable TROA background optimization
    """
    print(f"🚀 Processing with Enhanced VoiceTree (TADA + {'TROA' if enable_troa else 'No TROA'})")
    
    # Reset the workflow I/O log for a clean run
    if os.path.exists(WORKFLOW_IO_LOG):
        os.remove(WORKFLOW_IO_LOG)
        
    # Create fresh instances for each transcript
    decision_tree = DecisionTree()
    
    # Use a unique state file for each transcript to avoid cross-contamination
    import hashlib
    state_file_name = f"enhanced_benchmark_state_{hashlib.md5(transcript_file.encode()).hexdigest()[:8]}.json"
    
    # Create enhanced processor with TADA improvements
    processor = create_enhanced_transcription_processor(
        decision_tree=decision_tree,
        workflow_state_file=state_file_name,
        output_dir=OUTPUT_DIR,
        enable_background_optimization=enable_troa,
        optimization_interval_minutes=0.5 if enable_troa else 2  # Faster for benchmarking
    )
    
    # Setup fresh output directory
    setup_output_directory()
    
    with open(transcript_file, "r") as f:
        content = f.read()
    
    # Limit to max_words if specified
    if max_words:
        words = content.split()
        if len(words) > max_words:
            content = ' '.join(words[:max_words])
            print(f"Limited transcript to {max_words} words")
    
    # Start enhanced processing
    await processor.enhanced_tree_manager.start_enhanced_processing()
    
    try:
        # Process in chunks to simulate real-time processing
        # Use improved chunking that respects coherent thought units
        chunks = create_coherent_chunks(content, processor.enhanced_tree_manager.buffer_manager.buffer_size_threshold)
        
        print(f"📝 Processing {len(chunks)} coherent chunks...")
        
        for i, chunk in enumerate(chunks):
            print(f"   Chunk {i+1}/{len(chunks)}: \"{chunk[:50]}...\"")
            
            # Process the chunk
            await processor.process_and_convert(chunk)
            
            # Rate limiting to simulate real-time processing intervals
            time.sleep(SECONDS_PER_REQUEST)
            
            # Show progress
            stats = processor.get_system_status()
            tree_size = stats["quality_assessment"]["tree_size"]
            print(f"   → Tree size: {tree_size} nodes")
        
        # If TROA is enabled, wait for potential optimization
        if enable_troa:
            print("⏳ Waiting for TROA background optimization...")
            await asyncio.sleep(5)  # Give TROA time to optimize
            
            # Force final optimization
            processor.enhanced_tree_manager.force_troa_reorganization()
            print("✅ Final TROA optimization completed")
        
        # Finalize processing
        await processor.finalize()
        
        # Log enhanced statistics
        enhanced_stats = processor.get_enhanced_statistics()
        quality_assessment = processor.get_quality_assessment()
        
        print(f"\n📊 Enhanced Processing Results:")
        print(f"   • Processing Mode: {enhanced_stats['processing_mode']}")
        print(f"   • TADA Processes: {enhanced_stats['tada_processing_count']}")
        print(f"   • Estimated Quality: {quality_assessment['estimated_quality_score']}")
        
        if enable_troa and 'troa_metrics' in enhanced_stats:
            troa = enhanced_stats['troa_metrics']
            print(f"   • TROA Reorganizations: {troa['reorganizations_performed']}")
            print(f"   • Nodes Merged: {troa['nodes_merged']}")
            print(f"   • Relationships Optimized: {troa['relationships_optimized']}")
        
        logging.info(f"Enhanced workflow statistics: {enhanced_stats}")
        
    finally:
        # Stop enhanced processing
        await processor.enhanced_tree_manager.stop_enhanced_processing()
        
        # Clean up the temporary state file
        if os.path.exists(state_file_name):
            os.remove(state_file_name)


def create_coherent_chunks(content, buffer_threshold):
    """
    Create coherent chunks that respect thought boundaries
    (Implements the coherent thought unit principle from TADA)
    """
    # Split into sentences first
    sentences = re.split(r'[.!?]+', content)
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        
        # Add sentence to current chunk
        if current_chunk:
            current_chunk += ". " + sentence
        else:
            current_chunk = sentence
        
        # Check for coherent thought unit completion
        should_end_chunk = False
        
        # 1. Size-based threshold
        if len(current_chunk) >= buffer_threshold:
            should_end_chunk = True
        
        # 2. Discourse pattern completion
        completion_patterns = [
            r'\b(so|therefore|thus|hence|in conclusion|finally|ultimately)\b',
            r'\b(decided|will|going to|plan to)\b',
            r'\b(done|finished|completed|ready|that\'s it)\b'
        ]
        
        has_completion = any(re.search(pattern, current_chunk, re.IGNORECASE) for pattern in completion_patterns)
        
        # 3. Intention cycle completion (goal + method + reasoning)
        has_intention = bool(re.search(r'\b(I want to|need to|going to|plan to|the goal is)\b', current_chunk, re.IGNORECASE))
        has_method = bool(re.search(r'\b(by|through|using|with|via|first|then|next)\b', current_chunk, re.IGNORECASE))
        has_reasoning = bool(re.search(r'\b(because|since|so that|in order to|due to)\b', current_chunk, re.IGNORECASE))
        
        intention_cycle_complete = has_intention and (has_method or has_reasoning)
        
        # End chunk if we have completion markers or complete intention cycle
        if has_completion or intention_cycle_complete:
            should_end_chunk = True
        
        # 4. Multiple sentences with good content
        sentence_count = current_chunk.count('.') + current_chunk.count('!') + current_chunk.count('?')
        if sentence_count >= 3 and len(current_chunk) > buffer_threshold * 0.7:
            should_end_chunk = True
        
        if should_end_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = ""
    
    # Add any remaining content
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks


def evaluate_enhanced_tree_quality(transcript_file, transcript_name="", processing_mode="TADA"):
    """
    Evaluates the quality of the enhanced tree using an LLM
    Enhanced to understand TADA + TROA improvements
    """
    # Package the Markdown output for the LLM
    packaged_output = PackageProjectForLLM.package_project(OUTPUT_DIR, ".md")

    # Load enhanced prompts from the agentic workflow
    prompts_content = ""
    prompt_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../agentic_workflows/prompts'))
    if os.path.isdir(prompt_dir):
        for filename in sorted(os.listdir(prompt_dir)):
            if filename.endswith(".txt"):
                try:
                    with open(os.path.join(prompt_dir, filename), 'r') as f:
                        prompts_content += f"--- START OF ENHANCED PROMPT: {filename} ---\n"
                        prompts_content += f.read()
                        prompts_content += f"\n--- END OF ENHANCED PROMPT: {filename} ---\n\n"
                except Exception as e:
                    logging.error(f"Error reading prompt file {filename}: {e}")
    else:
        logging.warning(f"Prompts directory not found at: {prompt_dir}")

    # Enhanced evaluation prompt that understands TADA + TROA improvements
    prompt = (
        f"I have an ENHANCED VoiceTree system that converts spoken voice into knowledge trees using a sophisticated two-agent architecture:\n\n"
        f"**TADA (Tree Action Decider Agent)**: Real-time processing (2.5-3/5 quality) that maintains conversation flow\n"
        f"**TROA (Tree Reorganization Agent)**: Background optimization (5/5 quality) that continuously improves structure\n\n"
        f"**Key Improvements Implemented:**\n"
        f"1. **Coherent Thought Units** instead of atomic ideas (reduces fragmentation)\n"
        f"2. **Discourse Pattern Recognition** for natural language understanding\n"
        f"3. **Smart Integration Decisions** based on speech patterns\n"
        f"4. **Background Optimization** for continuous quality improvement\n\n"
        f"**Processing Mode for this test**: {processing_mode}\n\n"
        f"Here are the enhanced prompts used in the workflow:\n\n"
        f"```\n{prompts_content}```\n\n"
        f"Now, please evaluate the quality of the output generated from the following transcript:\n\n"
        f"**Original Transcript:**\n"
        f"```{open(transcript_file, 'r').read()}```\n\n"
        f"**Enhanced System Output:**\n"
        f"```{packaged_output}```\n\n"
        f"""
        You are an expert evaluating an ENHANCED VoiceTree system with significant improvements over the baseline.

        **Enhanced Evaluation Criteria:**
        
        * **Coherence & Thought Preservation**: Does the tree preserve complete thoughts and natural speech patterns? Are coherent thought units maintained instead of fragmented into atomic pieces?
        
        * **Discourse Pattern Recognition**: Does the system recognize and properly handle temporal sequences ("first, then, finally"), causal chains ("because, therefore"), elaborations ("for example, specifically"), and contrasts ("but, however, alternatively")?
        
        * **Semantic Integrity**: Are related concepts properly grouped? Does the tree maintain the speaker's intended meaning and narrative flow?
        
        * **Relationship Quality**: Are node relationships meaningful and logical? Do they reflect natural thought progressions rather than artificial connections?
        
        * **Content Extraction Success**: Is all important information captured without "unable to extract summary" errors? Are key insights preserved?
        
        * **Navigation & Structure**: Is the tree well-organized for human navigation? Does it follow intuitive hierarchies?

        **Scoring Scale:**
        Rate each dimension on a scale of 1 to 5:
        * 1: Unusable (major failures)
        * 2: Poor (significant issues)
        * 3: Acceptable (basic functionality)
        * 4: Good (solid performance)
        * 5: Excellent (exceptional quality)

        **Special Focus Areas:**
        - Compare against baseline atomic fragmentation (should be much improved)
        - Look for evidence of discourse pattern recognition
        - Assess whether coherent thought units are preserved
        - Evaluate if the tree "feels natural" to navigate
        - Check for background optimization effects (if TROA was enabled)

        **Expected Quality Range:**
        - TADA only: 2.5-3/5 (real-time processing with coherent thought units)
        - TADA + TROA: 4-5/5 (background optimization should improve structure)

        Provide a detailed evaluation addressing each enhanced criterion, with specific examples from the tree.
        Include scores for each dimension and an overall assessment.
        Note any evidence of the enhanced features working (or not working) as intended.
        """
    )

    logging.info("Enhanced quality assessment prompt:\n" + prompt)

    # Get the most recent Git commit information
    commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()

    # Use Gemini Pro for evaluation
    model = GenerativeModel('models/gemini-2.5-pro-preview-06-05')
    response = model.generate_content(prompt)

    # Log the quality assessment
    evaluation = response.text.strip()

    # Enhanced log entry with processing mode information
    log_entry = (
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Transcript: {transcript_name if transcript_name else transcript_file}\n"
        f"Git Commit: {commit_message} ({commit_hash})\n"
        f"Processing Method: Enhanced VoiceTree ({processing_mode})\n"
        f"System Features: Coherent Thought Units, Discourse Patterns, Smart Integration\n"
        f"Quality Score: {evaluation}\n\n"
    )

    # Write to enhanced quality log files
    with open(QUALITY_LOG_FILE, "a") as log_file:
        log_file.write(log_entry)

    with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
        log_file.write(log_entry)

    # Save enhanced run context
    run_context = {
        "date": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "transcript_file": os.path.abspath(transcript_file),
        "output_dir": os.path.abspath(OUTPUT_DIR),
        "quality_log_file": os.path.abspath(LATEST_QUALITY_LOG_FILE),
        "workflow_io_log": os.path.abspath(WORKFLOW_IO_LOG),
        "git_commit_hash": commit_hash,
        "git_commit_message": commit_message,
        "processing_method": f"Enhanced VoiceTree ({processing_mode})",
        "enhancements": [
            "Coherent Thought Units",
            "Discourse Pattern Recognition", 
            "Smart Integration Decisions",
            "Enhanced Buffer Management"
        ]
    }
    
    if processing_mode == "TADA + TROA":
        run_context["enhancements"].append("Background Optimization (TROA)")
    
    with open(LATEST_RUN_CONTEXT_FILE, "w") as f:
        json.dump(run_context, f, indent=4)

    print(f"✅ Quality evaluation completed and logged to {QUALITY_LOG_FILE}")


async def run_enhanced_benchmark_suite():
    """Run the complete enhanced benchmark suite"""
    print("🚀 Enhanced VoiceTree Benchmark Suite")
    print("=" * 60)
    print("Testing TADA improvements with existing benchmark infrastructure")
    print("=" * 60)
    
    # Test transcripts (following existing guide structure)
    test_transcripts = [
        {
            "file": "oldVaults/VoiceTreePOC/og_vt_transcript.txt",
            "name": "VoiceTree Original",
            "max_words": 150
        }
        # Can add more transcripts as needed
    ]
    
    # Test configurations
    test_configs = [
        {
            "name": "TADA Only (Real-time)",
            "enable_troa": False,
            "description": "Tests TADA improvements without background optimization"
        },
        {
            "name": "TADA + TROA (Full System)", 
            "enable_troa": True,
            "description": "Tests complete enhanced system with background optimization"
        }
    ]
    
    for config in test_configs:
        print(f"\n{'='*60}")
        print(f"🧪 Testing Configuration: {config['name']}")
        print(f"Description: {config['description']}")
        print(f"{'='*60}")
        
        for transcript_info in test_transcripts:
            print(f"\n📝 Processing: {transcript_info['name']}")
            print(f"Max words: {transcript_info['max_words']}")
            print(f"TROA enabled: {'✅' if config['enable_troa'] else '❌'}")
            
            try:
                # Process with enhanced system
                await process_transcript_with_enhanced_voicetree(
                    transcript_info['file'], 
                    transcript_info['max_words'],
                    config['enable_troa']
                )
                
                # Evaluate quality
                processing_mode = "TADA + TROA" if config['enable_troa'] else "TADA"
                evaluate_enhanced_tree_quality(
                    transcript_info['file'], 
                    transcript_info['name'],
                    processing_mode
                )
                
                print(f"✅ {config['name']} test completed successfully")
                
            except Exception as e:
                print(f"❌ Error in {config['name']} test: {e}")
                logging.error(f"Benchmark error: {e}")
    
    print(f"\n🎉 Enhanced benchmark suite completed!")
    print(f"📊 Results logged to: {QUALITY_LOG_FILE}")
    print(f"📁 Output files in: {OUTPUT_DIR}")


async def main():
    """Main function following existing benchmarker structure"""
    logging.basicConfig(level=logging.INFO)
    
    print("🎯 Enhanced VoiceTree Quality Benchmarker")
    print("Integrating TADA + TROA improvements with existing testing infrastructure")
    print("Following VoiceTree Testing & Debug Guide methodology")
    
    await run_enhanced_benchmark_suite()


if __name__ == "__main__":
    asyncio.run(main())