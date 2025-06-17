# this file runs VoiceTree on sample input and then gets an LLM to rate the quality of the output.

# take in a voice transcript file, such as /Users/bobbobby/repos/VoiceTreePoc/oldVaults/boeing/boeing_transcript.txt

# run VoiceTree system on this content, run it at 7 requests per minute, such that we don't get rate limited

# add n lines into the buffer per request until buffer full enough to be processed.

# Then, input into gemini pro the transcript and the resulting markdown files (e.g using PackageProjectForLLM)

# ask it the following prompt:

# Please evaluate the quality of the output versus the input. Score the quality on a scale of: Unusable, Poor, Acceptable, Good, Perfect.

# Then write to a quality log file the date, most recent git commit name and hash, and then quality score and comments.

#todo: include photo of tree?

#todo: include best representation of tree as text in prompt

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

from process_transcription import TranscriptionProcessor
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter
from backend import settings
import tools.PackageProjectForLLM as PackageProjectForLLM

# Configure Gemini API
genai.configure(api_key=settings.GOOGLE_API_KEY)

# Constants
REQUESTS_PER_MINUTE = 15  # to avoid breaching 15RPM gemini limit
SECONDS_PER_REQUEST = 60 / REQUESTS_PER_MINUTE
OUTPUT_DIR = "oldVaults/VoiceTreePOC/QualityTest"  # Replace with your desired output directory
QUALITY_LOG_FILE = "../quality_log.txt"  # Updated path to backend/benchmarker/
LATEST_QUALITY_LOG_FILE = "../latest_quality_log.txt"
LATEST_RUN_CONTEXT_FILE = "latest_run_context.json"
WORKFLOW_IO_LOG = "backend/agentic_workflows/workflow_io.log"


def setup_output_directory():
    """Handles backing up previous results and setting up a clean output directory."""
    if os.path.exists(OUTPUT_DIR):
        # Create a timestamped backup directory name
        backup_dir_base = "oldVaults/VoiceTreePOC/OLDQualityTest"
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


async def process_transcript_with_voicetree_limited(transcript_file, max_words=None):
    """Processes a transcript file with VoiceTree using agentic workflow, with optional word limit."""
    # Reset the workflow I/O log for a clean run
    if os.path.exists(WORKFLOW_IO_LOG):
        os.remove(WORKFLOW_IO_LOG)
        
    # Create fresh instances for each transcript
    decision_tree = DecisionTree()
    
    # Use a unique state file for each transcript to avoid cross-contamination
    import hashlib
    state_file_name = f"benchmark_workflow_state_{hashlib.md5(transcript_file.encode()).hexdigest()[:8]}.json"
    
    tree_manager = WorkflowTreeManager(
        decision_tree, 
        workflow_state_file=state_file_name
        # No need to specify buffer mode - it adapts automatically
    )
    
    # Clear any existing workflow state before processing
    tree_manager.clear_workflow_state()
    
    converter = TreeToMarkdownConverter(decision_tree.tree)
    
    # Setup fresh output directory
    setup_output_directory()
    
    processor = TranscriptionProcessor(tree_manager, converter, OUTPUT_DIR)
    
    with open(transcript_file, "r") as f:
        content = f.read()
    
    # Limit to max_words if specified
    if max_words:
        words = content.split()
        if len(words) > max_words:
            content = ' '.join(words[:max_words])
            print(f"Limited transcript to {max_words} words")
    
    # Process in chunks to simulate real-time processing
    # Create more coherent chunks based on sentence boundaries to reduce duplication
    sentences = re.split(r'[.!?]+', content)
    buffer = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
            
        # Add sentence to buffer
        buffer += sentence + ". "
        
        # Check if buffer is large enough or if we have multiple sentences
        sentence_count = buffer.count('.') + buffer.count('!') + buffer.count('?')
        
        # Process when we have enough content or multiple complete thoughts
        if len(buffer) >= tree_manager.text_buffer_size_threshold or sentence_count >= 3:
            # Process the current buffer
            await processor.process_and_convert(buffer.strip())
            # Reset the buffer
            buffer = ""
            # Rate limiting to simulate real-time processing intervals
            time.sleep(SECONDS_PER_REQUEST)
    
    # Process any remaining content in the buffer
    if buffer.strip():
        await processor.process_and_convert(buffer.strip())
    
    # Log workflow statistics
    workflow_stats = tree_manager.get_workflow_statistics()
    logging.info(f"Workflow statistics: {workflow_stats}")
    
    # Clean up the temporary state file
    if os.path.exists(state_file_name):
        os.remove(state_file_name)


def evaluate_tree_quality(transcript_file, transcript_name="") -> float:
    """
    Evaluates the quality of the generated tree using an LLM.
    
    Returns:
        Overall quality score as a float, or 0.0 if extraction failed
    """
    # Package the Markdown output for the LLM
    packaged_output = PackageProjectForLLM.package_project(OUTPUT_DIR, ".md")

    # Load prompts from the agentic workflow to include in the evaluation
    prompts_content = ""
    # Correctly locate the prompts directory relative to this script file
    prompt_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../agentic_workflows/prompts'))
    if os.path.isdir(prompt_dir):
        for filename in sorted(os.listdir(prompt_dir)): # sort to maintain order
            if filename.endswith(".txt"):
                try:
                    with open(os.path.join(prompt_dir, filename), 'r') as f:
                        prompts_content += f"--- START OF PROMPT: {filename} ---\n"
                        prompts_content += f.read()
                        prompts_content += f"\n--- END OF PROMPT: {filename} ---\n\n"
                except Exception as e:
                    logging.error(f"Error reading prompt file {filename}: {e}")
    else:
        logging.warning(f"Prompts directory not found at: {prompt_dir}")


    # Construct the evaluation prompt
    prompt = (
        f"I have a system which converts in real-time, spoken voice into a content tree (similar to a mind-map).\n"
        "This system uses an agentic workflow with several prompts to achieve its goal. For your reference, here are the prompts used in the workflow:\n\n"
        f"```\n{prompts_content}```\n\n"
        "Now, please evaluate the quality of the output (Markdown files) generated from the following transcript, keeping in mind the prompts that were used to generate it.\n\n"
        "Here is the original transcript:\n"
        f"```{open(transcript_file, 'r').read()}```\n\n"
        f"And here is the system's output that you need to assess:\n"
        "Markdown Output:\n\n"
        f"```{packaged_output}```\n\n"
        """
        You are an expert at evaluating the quality of decision trees created from spoken transcripts. 

        Here are the criteria for evaluating tree quality:
        
        * **Accuracy & Completeness:**  The tree should accurately represent the key information, points, and decisions from the transcript. It should include all essential information without significant omissions.
        * **Coherence:** The tree should be structured logically, with clear parent-child relationships between nodes. The connections between nodes should be meaningful and easy to follow.
        * **Conciseness:**  The tree should be free of redundancy. Each node should contain unique information and avoid repeating points already covered in other nodes.
        * **Relevance:**  The tree should prioritize the most important information from the transcript, focusing on key decisions and outcomes.
        * **Node Structure:** The tree should effectively separate distinct ideas into individual nodes.  There should be a balance between the number of nodes and their size.  Avoid creating too few large, unfocused nodes or too many small, fragmented nodes.  
        
        ## Scoring:
        
        Rate each dimension on a scale of 1 to 5, where:
        
        * 1: Unusable
        * 2: Poor 
        * 3: Acceptable
        * 4: Good
        * 5: Excellent
        
        Now, evaluate the following decision tree created from a spoken transcript:
        
        Provide a detailed evaluation of the tree's quality, addressing each of the criteria listed above.
         Outline a positive and a negative for each category. 
         Use specific examples from the tree to support your points.  
         Be sure to include a score for each dimension.
         Spend some time brainstorming, and allowing yourself time to think, 
         then work out the best answer in a step-by-step way to be sure we have the right answer. 
        """
        "Evaluate the tree. Please also include one final overall score, and a short summary of where the biggest areas for improvement are.\n\n"
        "Pay special attention to:\n"
        "- Node fragmentation (e.g., '50,000' split into '50' and '000' nodes)\n"
        "- Circular or illogical parent-child relationships\n"
        "- Whether technical concepts are properly grouped together\n"
        "- If the tree captures the main narrative flow of the conversation"
    )

    logging.info("Assess quality prompt:\n" + prompt)

    #     """
    #     ## Example:
    #
    # Here is an example of a transcript and a high-quality decision tree:
    #
    # **Transcript:**
    # We need to plan a marketing campaign for our new product launch.  First, we should define our target audience.  Who are we trying to reach? Then, we need to decide on our marketing channels. Will we use social media, email, or paid advertising?  Finally, we need to set a budget for the campaign.
    #
    # **Decision Tree:**
    #
    # ## Marketing Campaign Plan
    # -  Define Target Audience
    #     -  Research demographics, interests, and needs.
    # -  Choose Marketing Channels
    #     -  Social media strategy.
    #     -  Email marketing plan.
    #     -  Consider paid advertising options.
    # -  Set Campaign Budget
    #     -  Allocate funds across channels.
    #     -  Track return on investment (ROI)."""

    # Get the most recent Git commit information
    commit_hash = subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    commit_message = subprocess.check_output(['git', 'log', '-1', '--pretty=%B']).decode('utf-8').strip()

    # Use Gemini Pro for evaluation for the highest quality assessment
    model = GenerativeModel('models/gemini-2.5-pro-preview-06-05')
    response = model.generate_content(prompt)

    # Log the quality assessment
    evaluation = response.text.strip()
    
    # Extract the overall score for CI/CD purposes
    overall_score = extract_overall_score(evaluation)

    # Construct the full log entry
    log_entry = (
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Transcript: {transcript_name if transcript_name else transcript_file}\n"
        f"Git Commit: {commit_message} ({commit_hash})\n"
        f"Processing Method: Agentic Workflow (Multi-Stage)\n"
        f"Overall Score: {overall_score}\n"
        f"Quality Score: {evaluation}\n\n"
    )

    # Write to the main historical quality log file (append)
    with open(QUALITY_LOG_FILE, "a") as log_file:
        log_file.write(log_entry)

    # Write to a separate file for just the latest log (overwrite)
    with open(LATEST_QUALITY_LOG_FILE, "w") as log_file:
        log_file.write(log_entry)

    # Save the context of this run for the strategist
    run_context = {
        "date": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "transcript_file": os.path.abspath(transcript_file),
        "output_dir": os.path.abspath(OUTPUT_DIR),
        "quality_log_file": os.path.abspath(LATEST_QUALITY_LOG_FILE),
        "workflow_io_log": os.path.abspath(WORKFLOW_IO_LOG),
        "git_commit_hash": commit_hash,
        "git_commit_message": commit_message,
        "overall_score": overall_score
    }
    with open(LATEST_RUN_CONTEXT_FILE, "w") as f:
        json.dump(run_context, f, indent=4)
    
    return overall_score


def extract_overall_score(evaluation_text: str) -> float:
    """
    Extract the overall score from the LLM evaluation text.
    
    Args:
        evaluation_text: The full evaluation text from the LLM
        
    Returns:
        Overall score as a float, or 0.0 if not found
    """
    # Look for patterns like "Overall Score: 3.4", "Overall Score: 2.5 - Poor", etc.
    patterns = [
        r'Overall Score[:\s]+(\d+\.?\d*)',  # "Overall Score: 3.4"
        r'Overall[:\s]+(\d+\.?\d*)',        # "Overall: 3.4"
        r'Final Score[:\s]+(\d+\.?\d*)',    # "Final Score: 3.4"
    ]
    
    for pattern in patterns:
        match = re.search(pattern, evaluation_text, re.IGNORECASE)
        if match:
            try:
                score = float(match.group(1))
                print(f"📊 Extracted overall score: {score}")
                return score
            except ValueError:
                continue
    
    # If no explicit overall score found, try to extract from the final summary
    # Look for patterns like "2.5 - Poor", "3.4 - Acceptable", etc.
    summary_pattern = r'(\d+\.?\d*)\s*-\s*(Poor|Acceptable|Good|Excellent|Unusable)'
    matches = re.findall(summary_pattern, evaluation_text, re.IGNORECASE)
    
    if matches:
        # Take the last match as it's likely the overall score
        try:
            score = float(matches[-1][0])
            print(f"📊 Extracted score from summary: {score}")
            return score
        except ValueError:
            pass
    
    print("⚠️ Could not extract overall score from evaluation")
    return 0.0


async def main():
    # Test with multiple realistic transcripts
    test_transcripts = [
        {
            "file": "oldVaults/VoiceTreePOC/og_vt_transcript.txt",
            "name": "VoiceTree Original",
            "max_words": 150
        }
        # {
        #     "file": "oldVaults/MylesDBChat.txt", 
        #     "name": "Myles DB Chat",
        #     "max_words": 400
        # }
    ]
    
    all_scores = []
    
    for transcript_info in test_transcripts:
        print(f"\n{'='*60}")
        print(f"Testing: {transcript_info['name']}")
        print(f"{'='*60}\n")
        
        # Process with word limit
        await process_transcript_with_voicetree_limited(
            transcript_info['file'], 
            transcript_info['max_words']
        )
        score = evaluate_tree_quality(transcript_info['file'], transcript_info['name'])
        if score > 0:
            all_scores.append(score)
    
    # Calculate average score and determine CI/CD success
    if all_scores:
        avg_score = sum(all_scores) / len(all_scores)
        print(f"\n{'='*60}")
        print(f"📊 QUALITY BENCHMARKING RESULTS")
        print(f"{'='*60}")
        print(f"Individual scores: {all_scores}")
        print(f"Average score: {avg_score:.2f}")
        print(f"Threshold: >3.0")
        
        if avg_score > 3.0:
            print("✅ QUALITY CHECK PASSED")
            print(f"Average score ({avg_score:.2f}) exceeds threshold (3.0)")
            return 0  # Success
        else:
            print("❌ QUALITY CHECK FAILED") 
            print(f"Average score ({avg_score:.2f}) does not exceed threshold (3.0)")
            return 1  # Failure
    else:
        print("❌ QUALITY CHECK FAILED - No scores extracted")
        return 1  # Failure


if __name__ == "__main__":
    import sys
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
